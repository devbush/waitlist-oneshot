. "$(dirname "$0")/lib.sh"
# usage: orphan.sh <step> <port>
# Quota vs lists created before accounts existed (user_id NULL), on a copy of the step-0 -> step-1 data.
STEP=$1; P=$2; B=http://127.0.0.1:$P; D=s0to${STEP}orphan
rm -rf "$A/data/$D"; mkdir -p "$A/data/$D"
cp "$A"/data/s0to1/waitlist.db* "$A/data/$D/"
trap stop_server EXIT
start $STEP $P $D || exit 1
stop_server
# setup only: simulate a step-0 era list that already had 100 subscribers (written straight into the copied DB)
OID=$(q $D "select id from lists where user_id is null limit 1" | grep -o '[0-9]*'); OSLUG=$(q $D "select slug from lists where id=$OID" | sed -E 's/.*:"(.*)".*/\1/'); OTOK=$(q $D "select admin_token from lists where id=$OID" | sed -E 's/.*:"(.*)".*/\1/')
q $D "with recursive n(i) as (select 1 union all select i+1 from n where i<100) insert into subscribers (list_id,email,created_at) select $OID, 'old'||i||'@sub.dev', '2026-11-01T00:00:00.000Z' from n" exec
start $STEP $P $D || exit 1
J="$AW/data/$D/z.jar"
echo "orphan list $OSLUG has $(q $D "select count(*) n from subscribers where list_id=$OID") subscribers, no owner"
for i in 1 2 3 4 5; do echo -n "$(jpost $B/w/$OSLUG "{\"email\":\"late$i@sub.dev\"}") "; done; echo
q $D "select count(*) total, sum(locked) locked from subscribers where list_id=$OID"
sl -c $J $B/signup -d 'email=z@test.dev&password=passwordZ1' >/dev/null
echo "fresh free account claims it -> $(sl -b $J $B/admin/$OTOK)"
curl -s -b $J $B/lists | grep -o -E 'usage-count">[^<]*|Quota gratuit atteint[^<]*<[^>]*>[^<]*' | tr '\n' '|'; echo
echo "CSV lines exported by the free account: $(curl -s -b $J $B/lists/$OSLUG/export.csv | grep -c '@')"
stop_server; trap - EXIT
sleep 0.5; netstat -ano | grep LISTENING | grep ":$P " || echo "port $P free"
