. "$(dirname "$0")/lib.sh"
# Upgrade path: data created by step-0, server = step-1
P=4201; B=http://127.0.0.1:$P; D=s0to1
rm -rf "$A/data/$D"; mkdir -p "$A/data/$D"
cp "$A"/data/s0/waitlist.db* "$A/data/$D/"
. "$A/data/s0/vars"
echo "step-0 list: SLUG=$SLUG TOKEN=${TOKEN:0:6}..."
echo "before (step-0 data): $(q $D "select count(*) lists from lists") $(q $D "select count(*) subs from subscribers")"
trap stop_server EXIT
start_server 1 $P $D || exit 1
JA="$AW/data/$D/a.jar"; JB="$AW/data/$D/b.jar"

hr "old public page + signup still work"
echo "GET /w/$SLUG -> $(code $B/w/$SLUG) ; signup -> $(jpost $B/w/$SLUG '{"email":"after-upgrade@sub.dev"}')"

hr "old step-0 access paths, unauthenticated"
echo "GET /admin/TOKEN -> $(sl $B/admin/$TOKEN)"
echo "GET /admin/TOKEN/export.csv -> $(code $B/admin/$TOKEN/export.csv)"
echo "POST /admin/TOKEN/edit -> $(code $B/admin/$TOKEN/edit -d 'title=x')"
echo "POST /admin/TOKEN/delete -> $(code -X POST $B/admin/$TOKEN/delete)"
echo "POST /admin/TOKEN/subscribers/1/delete -> $(code -X POST $B/admin/$TOKEN/subscribers/1/delete)"
echo "POST /create -> $(code $B/create -d 'title=x')"
echo "home.js (step-0 'lists on this device') -> $(code $B/static/home.js)"

hr "account A claims the list through the legacy link"
echo "signup with next=/admin/TOKEN -> $(curl -s -D - -o NUL -c $JA $B/signup --data-urlencode 'email=a@test.dev' --data-urlencode 'password=passwordA1' --data-urlencode "next=/admin/$TOKEN" | tr -d '\r' | grep -iE '^HTTP|^location' | tr '\n' ' ')"
echo "follow -> $(sl -b $JA $B/admin/$TOKEN)"
echo "dashboard total -> $(curl -s -b $JA $B/lists/$SLUG | grep -o 'stat-value">[0-9]*' | head -1)"
curl -s -b $JA $B/lists/$SLUG/export.csv | tr -d '\r'; echo
echo "edit -> $(sl -b $JA $B/lists/$SLUG/edit -d 'title=Nebula claimed&description=ok')"

hr "account B tries the same legacy link afterwards"
sl -c $JB $B/signup -d 'email=b@test.dev&password=passwordB1' >/dev/null
echo "B GET /admin/TOKEN -> $(sl -b $JB $B/admin/$TOKEN)"
echo "B GET /lists/$SLUG -> $(code -b $JB $B/lists/$SLUG)"

hr "orphans: step-0 lists whose link was only kept in localStorage"
q $D "select count(*) unowned_lists from lists where user_id is null"
echo "B claims a random orphan using its token read from DB (= anyone holding an old link can claim):"
T2=$(q $D "select admin_token from lists where user_id is null limit 1" | sed -E 's/.*:"(.*)".*/\1/')
echo "  -> $(sl -b $JB $B/admin/$T2)"
q $D "select id,slug,user_id from lists order by id limit 4"
stop_server; trap - EXIT
sleep 0.5; netstat -ano | grep LISTENING | grep ":$P " || echo "port $P free"
