. "$(dirname "$0")/lib.sh"
# Remaining step-4 checks (auth code is byte-identical to step-1/2, re-verified here on the final version)
P=4204; B=http://127.0.0.1:$P; D=s4misc
rm -rf "$A/data/$D"; mkdir -p "$A/data/$D"
trap stop_server EXIT
start 4 $P $D || exit 1
JA="$AW/data/$D/a.jar"
echo "signup A -> $(sl -c $JA $B/signup -d 'email=a@test.dev&password=passwordA1')"
L=$(sl -b $JA $B/lists --data-urlencode 'title=T <b>x</b>' | grep -o '/lists/[a-z0-9-]*' | cut -d/ -f3)
TOK=$(grep wl_session $JA | awk '{print $7}')

hr "robustness"
echo "public POST JSON null -> $(code -H "$JH" -H "$JA_" -d 'null' $B/w/$L) ; JSON array -> $(code -H "$JH" -H "$JA_" -d '[]' $B/w/$L) ; ref as object -> $(jpost $B/w/$L '{"email":"r1@sub.dev","ref":{"a":1}}' | cut -c1-60)"
echo "bad cookie + valid session -> $(code -H "Cookie: foo=%zz; wl_session=$TOK" $B/lists) ; valid session alone -> $(code -H "Cookie: wl_session=$TOK" $B/lists)"
echo "HEAD / -> $(curl -s -o NUL -w '%{http_code}' -I $B/) ; PUT /lists/$L -> $(code -b $JA -X PUT $B/lists/$L) ; DELETE -> $(code -b $JA -X DELETE $B/lists/$L)"
echo "17KB form body on /lists -> $(head -c 17000 /dev/zero | tr '\0' 'a' | curl -s -o NUL -w '%{http_code}' -b $JA --data-binary @- $B/lists)"

hr "same email, 8 parallel requests"
PIDS=""; for i in 1 2 3 4 5 6 7; do curl -s -o NUL -H "$JH" -H "$JA_" -d '{"email":"same@sub.dev"}' $B/w/$L & PIDS="$PIDS $!"; done; wait $PIDS
q $D "select count(*) rows_for_same from subscribers where email='same@sub.dev'"

hr "CSV formula injection"
restart
for e in '=1+1@x.co' '+1@x.co' '-1@x.co'; do jpost $B/w/$L "{\"email\":\"$e\"}" >/dev/null; done
curl -s -b $JA $B/lists/$L/export.csv | tr -d '\r' | grep -E 'x\.co'

hr "Host header reflected in the owner's dashboard"
curl -s -b $JA -H 'Host: evil.example' $B/lists/$L | grep -o 'value="http[^"]*"' | head -1

hr "brute force on the final version"
for i in $(seq 1 12); do echo -n "$(code $B/login -d "email=a@test.dev&password=wrong$i") "; done; echo
echo "right password while blocked -> $(code $B/login -d 'email=a@test.dev&password=passwordA1')"

hr "session row"
q $D "select length(token_hash) len, (expires_at - strftime('%s','now')*1000)/86400000 days_left from sessions limit 1"
stop_server; trap - EXIT
sleep 0.5; netstat -ano | grep LISTENING | grep ":$P " || echo "port $P free"

hr "tests"
for k in 0 1 2 4; do echo "step-$k: test files: $(find "$A/step-$k" -type f \( -iname '*test*' -o -iname '*spec*' \) | wc -l) ; npm test -> $(cd "$A/step-$k" && npm test 2>&1 | grep -m1 -i 'missing script\|error' )"; done
