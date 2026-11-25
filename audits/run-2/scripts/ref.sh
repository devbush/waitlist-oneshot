. "$(dirname "$0")/lib.sh"
# Referral checks on step-4. TRUST_PROXY=1 so that X-Forwarded-For stands for distinct visitors.
P=4204; B=http://127.0.0.1:$P; D=s4ref
rm -rf "$A/data/$D"; mkdir -p "$A/data/$D"
trap stop_server EXIT
start 4 $P $D TRUST_PROXY=1 || exit 1
JA="$AW/data/$D/a.jar"; JB="$AW/data/$D/b.jar"
sl -c $JA $B/signup -d 'email=a@test.dev&password=passwordA1' >/dev/null
sl -c $JB $B/signup -d 'email=b@test.dev&password=passwordB1' >/dev/null
L=$(sl -b $JA $B/lists -d 'title=Ref list' | grep -o '/lists/[a-z0-9-]*' | cut -d/ -f3)
LB=$(sl -b $JB $B/lists -d 'title=Other list' | grep -o '/lists/[a-z0-9-]*' | cut -d/ -f3)
# s <ip> <slug> <email> [ref]
s() { local r=""; [ -n "$4" ] && r=",\"ref\":\"$4\""; curl -s -w ' [%{http_code}]' -H "$JH" -H "$JA_" -H "X-Forwarded-For: $1" -d "{\"email\":\"$3\"$r}" $B/w/$2; }
pos() { s 10.9.9.$((RANDOM%250+1)) $L "$1" | grep -o '"position":[0-9]*,"total":[0-9]*,"referrals":[0-9]*'; }
code_of() { q $D "select ref_code from subscribers s join lists l on l.id=s.list_id where l.slug='$2' and s.email='$1'" | sed -E 's/.*:"(.*)".*/\1/'; }

hr "6 people sign up, each from its own IP"
for i in 1 2 3 4 5 6; do echo "p$i -> $(s 10.0.0.$i $L p$i@sub.dev)"; done
C6=$(code_of p6@sub.dev $L); C5=$(code_of p5@sub.dev $L); C4=$(code_of p4@sub.dev $L)

hr "invite page"
echo "GET ?ref=<p6 code>: invited banner $(curl -s "$B/w/$L?ref=$C6" | grep -c 'class="invited"') hidden field $(curl -s "$B/w/$L?ref=$C6" | grep -c 'name="ref"')"
echo "GET ?ref=<script>: reflected? $(curl -s "$B/w/$L?ref=%22%3E%3Cscript%3Ealert(1)%3C/script%3E" | grep -c -E 'alert\(1\)|name="ref"')"
echo "GET ?ref=AAAAAAAAAAAA (unknown): hidden field $(curl -s "$B/w/$L?ref=AAAAAAAAAAAA" | grep -c 'name="ref"')"
echo "p6 code on another owner's list: hidden field $(curl -s "$B/w/$LB?ref=$C6" | grep -c 'name="ref"')"

hr "a friend signs up with p6's link from another IP -> p6 moves up"
echo "p6 before: $(pos p6@sub.dev)"
echo "friend -> $(s 10.0.1.1 $L friend1@sub.dev $C6)"
echo "p6 after:  $(pos p6@sub.dev)"

hr "anti-cheat as designed"
echo "same IP as referrer (p5 from 10.0.0.5 refers itself): $(s 10.0.0.5 $L p5bis@sub.dev $C5 >/dev/null; pos p5@sub.dev)"
s 10.0.2.1 $L p4f1@sub.dev $C4 >/dev/null; s 10.0.2.1 $L p4f2@sub.dev $C4 >/dev/null; s 10.0.2.1 $L p4f3@sub.dev $C4 >/dev/null
echo "3 referred signups from one other IP count once: p4 $(pos p4@sub.dev)"
echo "p6's code posted on another list is ignored: $(s 10.0.3.1 $LB cross@sub.dev $C6 | cut -c1-80) ; referred_by=$(q $D "select referred_by from subscribers where email='cross@sub.dev'")"

hr "abuse: invented addresses, one request per source address (no email confirmation)"
echo "p5 before: $(pos p5@sub.dev)"
for i in 1 2 3; do s 10.7.7.$i $L "fake$i-$RANDOM@nowhere.invalid" $C5 >/dev/null; done
echo "p5 after 3 fake referrals: $(pos p5@sub.dev)"

hr "what a stranger learns by typing someone else's email"
echo "known email   -> $(s 203.0.113.9 $L p1@sub.dev)"
echo "unknown email would be registered (201); invalid -> $(s 203.0.113.9 $L nope)"
echo "no-JS form, known email -> $(curl -s -H 'X-Forwarded-For: 203.0.113.10' $B/w/$L -d 'email=p2@sub.dev' | grep -o -E 'data-position>[0-9]*|data-ref-url[^>]*|value="http[^"]*"' | tr '\n' ' ')"

hr "Host / X-Forwarded-Proto reflected in the referral link"
echo "$(curl -s -H "$JH" -H "$JA_" -H 'Host: evil.example' -H 'X-Forwarded-Proto: javascript' -H 'X-Forwarded-For: 203.0.113.11' -d '{"email":"p3@sub.dev"}' $B/w/$L | grep -o '"refUrl":"[^"]*"')"

hr "X-Forwarded-For handling"
echo "TRUST_PROXY=1, client-supplied first hop ignored? 10 signups with 'X-Forwarded-For: <random>, 198.51.100.7':"
for i in $(seq 1 10); do echo -n "$(curl -s -o NUL -w '%{http_code}' -H "$JH" -H "$JA_" -H "X-Forwarded-For: 1.2.3.$i, 198.51.100.7" -d "{\"email\":\"xff$i@sub.dev\"}" $B/w/$L) "; done; echo
echo "TRUST_PROXY=1 but no proxy in front (client controls the whole header): 12 signups, 12 addresses:"
for i in $(seq 1 12); do echo -n "$(curl -s -o NUL -w '%{http_code}' -H "$JH" -H "$JA_" -H "X-Forwarded-For: 198.18.0.$i" -d "{\"email\":\"spoof$i@sub.dev\"}" $B/w/$L) "; done; echo

hr "owner view + CSV"
curl -s -b $JA $B/lists/$L/export.csv | tr -d '\r' | head -6; echo
echo "dashboard 'Via parrainage': $(curl -s -b $JA $B/lists/$L | grep -A1 'Via parrainage' | grep -o 'stat-value">[0-9]*')"
echo "ip stored: $(q $D "select email, ip_hash from subscribers where email='p1@sub.dev'") ; secret in DB: $(q $D "select key, length(value) len from meta")"

hr "owner removes a referred subscriber -> referrer loses the boost ; removes a referrer -> referred rows keep working"
FID=$(q $D "select id from subscribers where email='friend1@sub.dev'" | grep -o '[0-9]*')
echo "delete friend1 -> $(code -b $JA -X POST $B/lists/$L/subscribers/$FID/delete) ; p6 $(pos p6@sub.dev)"
P5=$(q $D "select id from subscribers where email='p5@sub.dev'" | grep -o '[0-9]*')
echo "delete p5 -> $(code -b $JA -X POST $B/lists/$L/subscribers/$P5/delete) ; rows still pointing at p5: $(q $D "select count(*) n from subscribers where referred_by=$P5") ; dashboard $(code -b $JA $B/lists/$L)"
echo "B deletes A's subscriber through B's own list path -> $(code -b $JB -X POST $B/lists/$LB/subscribers/1/delete) ; p1 still there: $(q $D "select count(*) n from subscribers where id=1")"

stop_server
hr "default config (TRUST_PROXY unset): the header is ignored"
start 4 $P $D || exit 1
C1=$(code_of p1@sub.dev $L)
echo "p1 before: $(curl -s -H "$JH" -H "$JA_" -d '{"email":"p1@sub.dev"}' $B/w/$L | grep -o '"position":[0-9]*,"total":[0-9]*,"referrals":[0-9]*')"
curl -s -o NUL -H "$JH" -H "$JA_" -H 'X-Forwarded-For: 8.8.8.8' -d '{"email":"d1@sub.dev","ref":"'$C1'"}' $B/w/$L
curl -s -o NUL -H "$JH" -H "$JA_" -H 'X-Forwarded-For: 8.8.4.4' -d '{"email":"d2@sub.dev","ref":"'$C1'"}' $B/w/$L
echo "p1 after 2 referred signups from the same socket address (two different XFF): $(curl -s -H "$JH" -H "$JA_" -d '{"email":"p1@sub.dev"}' $B/w/$L | grep -o '"position":[0-9]*,"total":[0-9]*,"referrals":[0-9]*')"
for i in $(seq 1 6); do echo -n "$(curl -s -o NUL -w '%{http_code}' -H "$JH" -H "$JA_" -H "X-Forwarded-For: 9.9.9.$i" -d "{\"email\":\"lim$i@sub.dev\"}" $B/w/$L) "; done; echo " <- limiter keyed on socket address (8/min)"
stop_server; trap - EXIT
sleep 0.5; netstat -ano | grep LISTENING | grep ":$P " || echo "port $P free"
