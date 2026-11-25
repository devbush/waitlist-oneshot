. "$(dirname "$0")/lib.sh"
# usage: reg.sh <step> <port> <source data dir> <dest data dir>
# Upgrade path + regression: start step K on a copy of data produced by the previous step.
STEP=$1; P=$2; SRC=$3; D=$4; B=http://127.0.0.1:$P
rm -rf "$A/data/$D"; mkdir -p "$A/data/$D"
cp "$A"/data/$SRC/waitlist.db* "$A/data/$D/"
echo "data before start: $(q $D "select count(*) users from users") $(q $D "select count(*) lists from lists") $(q $D "select count(*) subs from subscribers")"
trap stop_server EXIT
start $STEP $P $D || exit 1
JA="$AW/data/$D/a.jar"; JB="$AW/data/$D/b.jar"
echo "data after start:  $(q $D "select count(*) users from users") $(q $D "select count(*) lists from lists") $(q $D "select count(*) subs from subscribers")"
echo "subscribers columns: $(q $D "select group_concat(name) cols from pragma_table_info('subscribers')")"
echo "users columns: $(q $D "select group_concat(name) cols from pragma_table_info('users')")"

hr "old account logs in with its old password, old list still there"
echo "login A -> $(curl -s -D - -o NUL -c $JA $B/login -d 'email=a@test.dev&password=password' | tr -d '\r' | grep -iE '^HTTP|^location' | tr '\n' ' ')"
SA=$(curl -s -b $JA $B/lists | grep -o 'href="/lists/[a-z0-9-]*"' | head -1 | cut -d/ -f3 | tr -d '"'); echo "A's list: $SA"
echo "dashboard -> $(code -b $JA $B/lists/$SA) total $(curl -s -b $JA $B/lists/$SA | grep -o 'stat-value">[0-9]*' | head -1)"
curl -s -b $JA $B/lists/$SA/export.csv | tr -d '\r'; echo

hr "public signup: ok / duplicate / invalid / honeypot"
echo "ok -> $(jpost $B/w/$SA '{"email":"new-k@sub.dev"}')"
echo "dup -> $(jpost $B/w/$SA '{"email":"new-k@sub.dev"}')"
echo "invalid -> $(jpost $B/w/$SA '{"email":"nope"}')"
echo "honeypot -> $(jpost $B/w/$SA '{"email":"bot@sub.dev","website":"x"}')"
echo "form no-JS -> $(curl -s -D - -o NUL $B/w/$SA -d 'email=nojs@sub.dev' | tr -d '\r' | grep -iE '^HTTP|^location' | tr '\n' ' ')"
echo "dashboard total -> $(curl -s -b $JA $B/lists/$SA | grep -o 'stat-value">[0-9]*' | head -1)"

hr "edit / delete subscriber / create / delete list"
echo "edit -> $(sl -b $JA $B/lists/$SA/edit --data-urlencode 'title=<img src=x onerror=alert(1)> K' --data-urlencode 'description="><script>alert(2)</script>')"
SID=$(q $D "select s.id from subscribers s join lists l on l.id=s.list_id where l.slug='$SA' and email='nojs@sub.dev'" | grep -o '[0-9]*')
echo "delete subscriber $SID -> $(sl -b $JA -X POST $B/lists/$SA/subscribers/$SID/delete)"
NL=$(sl -b $JA $B/lists -d 'title=Temp&description=t' | grep -o '/lists/[a-z0-9-]*' | cut -d/ -f3); echo "create -> $NL ; delete -> $(sl -b $JA -X POST $B/lists/$NL/delete) ; public -> $(code $B/w/$NL)"
echo "XSS unescaped (dashboard, /lists, public, billing): $(curl -s -b $JA $B/lists/$SA | grep -c -E '<img src=x|<script>alert') $(curl -s -b $JA $B/lists | grep -c -E '<img src=x|<script>alert') $(curl -s $B/w/$SA | grep -c -E '<img src=x|<script>alert') $(curl -s -b $JA $B/billing | grep -c -E '<img src=x|<script>alert')"

hr "cross-account"
echo "login B -> $(curl -s -D - -o NUL -c $JB $B/login -d 'email=b@test.dev&password=passwordB1' | tr -d '\r' | grep -iE '^HTTP|^location' | tr '\n' ' ')"
SB=$(sl -b $JB $B/lists -d 'title=B private' | grep -o '/lists/[a-z0-9-]*' | cut -d/ -f3)
jpost $B/w/$SB '{"email":"bsub@sub.dev"}' >/dev/null
BSUB=$(q $D "select id from subscribers where email='bsub@sub.dev'" | grep -o '[0-9]*')
echo "A: GET dash $(code -b $JA $B/lists/$SB) | export $(code -b $JA $B/lists/$SB/export.csv) | edit $(code -b $JA $B/lists/$SB/edit -d 'title=H') | delete $(code -b $JA -X POST $B/lists/$SB/delete) | del B's sub via B path $(code -b $JA -X POST $B/lists/$SB/subscribers/$BSUB/delete) | via own path $(code -b $JA -X POST $B/lists/$SA/subscribers/$BSUB/delete)"
echo "B's data intact: $(q $D "select title,(select count(*) from subscribers where list_id=lists.id) n from lists where slug='$SB'")"
echo "unauth: /lists $(code $B/lists) | dash $(code $B/lists/$SB) | export $(code $B/lists/$SB/export.csv) | billing $(code $B/billing) | POST checkout $(code -X POST $B/billing/checkout) | POST portal $(code -X POST $B/billing/portal)"
TB=$(q $D "select admin_token from lists where slug='$SB'" | sed -E 's/.*:"(.*)".*/\1/')
echo "A with B's legacy token: $(code -b $JA $B/admin/$TB) | unauth: $(sl $B/admin/$TB)"
echo "CSRF: billing checkout Origin evil -> $(code -b $JA -H 'Origin: https://evil.example' -X POST $B/billing/checkout) ; logout Origin evil -> $(code -b $JA -H 'Origin: https://evil.example' -X POST $B/logout)"
if [ "$STEP" = "4" ]; then
  RC=$(q $D "select ref_code from subscribers where email='bsub@sub.dev'" | sed -E 's/.*:"(.*)".*/\1/')
  echo "B list ref code used on A's list -> hidden ref field present: $(curl -s "$B/w/$SA?ref=$RC" | grep -c 'name="ref"') ; on B's own list: $(curl -s "$B/w/$SB?ref=$RC" | grep -c 'name="ref"')"
  echo "old subscribers got a ref code: $(q $D "select count(*) total, count(ref_code) with_code, count(ip_hash) with_ip from subscribers")"
fi

hr "headers on an authenticated page"
curl -s -D - -o NUL -b $JA $B/billing | tr -d '\r' | grep -iE 'content-security|x-content|referrer|cache-control|strict-transport|x-frame'

hr "restart -> persistence"
restart
echo "A session after restart: $(code -b $JA $B/lists/$SA) ; total $(curl -s -b $JA $B/lists/$SA | grep -o 'stat-value">[0-9]*' | head -1)"
stop_server; trap - EXIT
sleep 0.5; netstat -ano | grep LISTENING | grep ":$P " || echo "port $P free"
