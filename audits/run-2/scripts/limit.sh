. "$(dirname "$0")/lib.sh"
# usage: limit.sh <step> <port>   (no Stripe key configured)
STEP=$1; P=$2; B=http://127.0.0.1:$P; D=s${STEP}limit
rm -rf "$A/data/$D"; mkdir -p "$A/data/$D"
trap stop_server EXIT
start $STEP $P $D || exit 1
JA="$AW/data/$D/a.jar"; JC="$AW/data/$D/c.jar"
login() { sl -c $JA $B/login -d 'email=a@test.dev&password=passwordA1' >/dev/null; }
sl -c $JA $B/signup -d 'email=a@test.dev&password=passwordA1' >/dev/null
L1=$(sl -b $JA $B/lists -d 'title=L1' | grep -o '/lists/[a-z0-9-]*' | cut -d/ -f3)
L2=$(sl -b $JA $B/lists -d 'title=L2' | grep -o '/lists/[a-z0-9-]*' | cut -d/ -f3)
echo "L1=$L1 L2=$L2"
usage() { q $D "select count(*) total, coalesce(sum(locked),0) locked from subscribers s join lists l on l.id=s.list_id where l.user_id=1"; }

hr "fill: 60 on L1 + 38 on L2 = 98 (all through the public HTTP form)"
bulk $P $L1 u 1 60; bulk $P $L2 v 1 38; usage

hr "8 concurrent signups crossing the limit (expect exactly 2 unlocked, 6 locked)"
restart
PIDS=""; for i in 1 2 3 4 5 6 7 8; do curl -s -o NUL -H "$JH" -H "$JA_" -d "{\"email\":\"w$i@sub.dev\"}" $B/w/$L2 & PIDS="$PIDS $!"; done; wait $PIDS
NREQ=8
usage
q $D "select email, locked from subscribers where email like 'w%' order by id"

hr "what the owner sees"
curl -s -b $JA $B/lists | grep -o -E 'usage-count">[^<]*|Quota gratuit atteint[^<]*<[^>]*>[^<]*|[0-9]+ verrouillés?' | tr '\n' '|'; echo
curl -s -b $JA $B/lists/$L2 > "$A/data/$D/l2.html"
LOCKED_EMAILS=$(q $D "select email from subscribers where locked=1" | sed -E 's/.*:"(.*)".*/\1/')
for e in $LOCKED_EMAILS; do echo -n "$e in dashboard HTML: $(grep -c "$e" "$A/data/$D/l2.html")  "; done; echo
echo "masked rows: $(grep -c 'locked-row' "$A/data/$D/l2.html") ; total shown: $(grep -o 'stat-value">[0-9]*' "$A/data/$D/l2.html" | head -1)"
curl -s -b $JA $B/lists/$L2/export.csv > "$A/data/$D/l2.csv"
echo "CSV data lines: $(($(tr -d '\r' < "$A/data/$D/l2.csv" | grep -c '@'))) ; locked emails in CSV: $(grep -c -E 'w[3-8]@sub.dev' "$A/data/$D/l2.csv") ; DB rows on L2: $(q $D "select count(*) n, sum(locked) locked from subscribers s join lists l on l.id=s.list_id where l.slug='$L2'")"
echo "public counter (visitor): $(curl -s $B/w/$L2 | grep -o 'data-count>[0-9]*')"

hr "bypass 1: delete visible subscribers to make room (export first, then delete 10 on L1)"
for id in $(q $D "select s.id from subscribers s join lists l on l.id=s.list_id where l.slug='$L1' and s.locked=0 limit 10" | grep -o '[0-9]*'); do code -b $JA -X POST $B/lists/$L1/subscribers/$id/delete >/dev/null; done
usage
restart
for i in 1 2 3 4 5 6; do echo -n "$(pub $P $L2 "x$i@sub.dev") "; done; echo
q $D "select email, locked from subscribers where email like 'x%' order by id"
usage

restart
hr "bypass 2: delete a whole list (60 gone), keep collecting"
echo "delete L1 -> $(sl -b $JA -X POST $B/lists/$L1/delete)"; usage
for i in 1 2; do echo -n "$(pub $P $L2 "y$i@sub.dev") "; done; echo
q $D "select email, locked from subscribers where email like 'y%' order by id"
echo "previously locked rows still locked: $(q $D "select count(*) n from subscribers where locked=1")"

restart
hr "bypass 3: delete a locked row, the same person signs up again while there is room"
LID=$(q $D "select id from subscribers where locked=1 limit 1" | grep -o '[0-9]*'); LEM=$(q $D "select email from subscribers where id=$LID" | sed -E 's/.*:"(.*)".*/\1/')
echo "delete locked id=$LID ($LEM) -> $(code -b $JA -X POST $B/lists/$L2/subscribers/$LID/delete) ; re-signup -> $(pub $P $L2 "$LEM")"
q $D "select email, locked from subscribers where email='$LEM'"

restart
hr "bypass 4: a second free account has its own fresh 100"
sl -c $JC $B/signup -d 'email=c@test.dev&password=passwordC1' >/dev/null
LC=$(sl -b $JC $B/lists -d 'title=LC' | grep -o '/lists/[a-z0-9-]*' | cut -d/ -f3)
echo "signup on C's list -> $(pub $P $LC "c1@sub.dev")"; q $D "select email, locked from subscribers where email='c1@sub.dev'"

hr "billing without Stripe key"
curl -s -b $JA $B/billing | grep -o -E 'Paiement indisponible|Passer en Pro[^<]*' | head -3
echo "POST /billing/checkout -> $(sl -b $JA -X POST $B/billing/checkout)"
echo "POST /billing/portal -> $(sl -b $JA -X POST $B/billing/portal)"
echo "GET /billing?checkout=success&session_id=cs_x -> $(curl -s -b $JA "$B/billing?checkout=success&session_id=cs_x" | grep -o 'class="toast[^<]*' | head -1) ; pro? $(q $D "select subscription_status from users where id=1")"
echo "POST /stripe/webhook unsigned -> $(curl -s -w ' [%{http_code}]' $B/stripe/webhook -H "$JH" -d '{"type":"customer.subscription.updated","data":{"object":{"id":"sub_x","status":"active"}}}')"
for r in /billing/upgrade /billing/plan /api/plan /billing/success /billing/mock /billing/test; do echo -n "POST $r -> $(code -b $JA -X POST $B$r -d 'plan=pro') ; "; done; echo
echo "POST /billing (plan=pro) -> $(code -b $JA $B/billing -d 'plan=pro&subscription_status=active')"
stop_server; trap - EXIT
sleep 0.5; netstat -ano | grep LISTENING | grep ":$P " || echo "port $P free"
