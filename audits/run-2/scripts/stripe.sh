. "$(dirname "$0")/lib.sh"
# usage: stripe.sh <step> <port>   Billing code switched on with fake values, Stripe API replaced by a local stand-in on 4210.
STEP=$1; P=$2; B=http://127.0.0.1:$P; D=s${STEP}stripe; FP=4210; F=http://127.0.0.1:$FP
rm -rf "$A/data/$D"; mkdir -p "$A/data/$D"
FLOG="$AW/data/$D/fake-stripe.log"; : > "$FLOG"
node "$AW/scripts/fake-stripe.mjs" $FP "$FLOG" > "$A/data/$D/fake.out" 2>&1 &
FPID=$!
cleanup() { stop_server; kill $FPID 2>/dev/null; wait $FPID 2>/dev/null; }
trap cleanup EXIT
SECRET=whsec_fake
start $STEP $P $D STRIPE_SECRET_KEY=sk_test_fake STRIPE_API_BASE=$F STRIPE_WEBHOOK_SECRET=$SECRET || exit 1
JA="$AW/data/$D/a.jar"; JB="$AW/data/$D/b.jar"
sl -c $JA $B/signup -d 'email=a@test.dev&password=passwordA1' >/dev/null
sl -c $JB $B/signup -d 'email=b@test.dev&password=passwordB1' >/dev/null
L=$(sl -b $JA $B/lists -d 'title=LA' | grep -o '/lists/[a-z0-9-]*' | cut -d/ -f3)
bulk $P $L u 1 103
st() { q $D "select id, email, stripe_customer_id cus, stripe_subscription_id sub, subscription_status status from users where id in (1,2)"; }
usage() { q $D "select count(*) total, coalesce(sum(locked),0) locked from subscribers"; }
# whk <secret> <timestamp> <payload> [signature override]
whk() {
  local sig; sig=$(printf '%s.%s' "$2" "$3" | openssl dgst -sha256 -hmac "$1" | awk '{print $NF}')
  [ -n "$4" ] && sig=$4
  curl -s -w ' [%{http_code}]' -H "$JH" -H "Stripe-Signature: t=$2,v1=$sig" --data-binary "$3" $B/stripe/webhook
}
NOW() { date +%s; }
echo "start: $(usage)"; st

hr "checkout: what the app sends to Stripe"
LOC=$(sl -b $JA -X POST $B/billing/checkout); echo "A POST /billing/checkout -> $LOC"
CSA=$(echo "$LOC" | grep -o 'cs_test_fake[0-9]*')
sed -E 's/"auth":"Bearer sk_test_fake"/"auth":"Bearer <key>"/' "$FLOG"
st

hr "become Pro without paying?"
echo "A success URL, own UNPAID session $CSA -> $(curl -s -b $JA "$B/billing?checkout=success&session_id=$CSA" | grep -o 'class="toast[^<]*' | head -1)"; st | head -1
LOCB=$(sl -b $JB -X POST $B/billing/checkout); CSB=$(echo "$LOCB" | grep -o 'cs_test_fake[0-9]*')
curl -s -X POST "$F/_ctl/pay?session=$CSB&status=active" >/dev/null
echo "B paid session $CSB (Stripe side). A opens success URL with B's session -> $(curl -s -b $JA "$B/billing?checkout=success&session_id=$CSB" | grep -o 'class="toast[^<]*' | head -1)"; st
SUBA=$(curl -s -X POST "$F/_ctl/pay?session=$CSA&status=incomplete" | grep -o 'sub_fake[0-9]*' | head -1)
echo "A's own session now has subscription $SUBA with status=incomplete -> $(curl -s -b $JA "$B/billing?checkout=success&session_id=$CSA" | grep -o 'class="toast[^<]*' | head -1)"; st | head -1
echo "session_id path injection -> $(code -b $JA "$B/billing?checkout=success&session_id=../subscriptions/$SUBA") ; Stripe saw: $(tail -1 "$FLOG" | grep -o '"p":"[^"]*"')"
echo "success URL without session_id -> $(curl -s -b $JA "$B/billing?checkout=success" | grep -o 'class="toast[^<]*' | head -1)"

hr "webhook signature"
EV='{"id":"evt_1","type":"customer.subscription.updated","data":{"object":{"id":"'$SUBA'","status":"active","customer":"cus_fake1"}}}'
T=$(NOW)
echo "no signature header   -> $(curl -s -w ' [%{http_code}]' -H "$JH" --data-binary "$EV" $B/stripe/webhook)"
echo "wrong secret          -> $(whk whsec_wrong $T "$EV")"
echo "empty secret          -> $(whk '' $T "$EV")"
echo "valid sig, t-600s     -> $(whk $SECRET $((T-600)) "$EV")"
echo "valid sig, t+600s     -> $(whk $SECRET $((T+600)) "$EV")"
GOOD=$(printf '%s.%s' "$T" "$EV" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')
echo "valid sig, body tampered -> $(curl -s -w ' [%{http_code}]' -H "$JH" -H "Stripe-Signature: t=$T,v1=$GOOD" --data-binary "${EV/evt_1/evt_2}" $B/stripe/webhook)"
echo "sig of 64 non-hex chars -> $(whk $SECRET $T "$EV" "$(printf 'z%.0s' $(seq 1 64))")"
echo "sig with a non-ASCII char (64 chars) -> $(curl -s -o NUL -w '[%{http_code}]' -H "$JH" -H "Stripe-Signature: t=$T,v1=$(printf 'a%.0s' $(seq 1 63))$(printf '\xe9')" --data-binary "$EV" $B/stripe/webhook)"
echo "VALID sig, payload says active but Stripe says incomplete -> $(whk $SECRET $T "$EV")"; st | head -1
echo "cross-origin header on webhook (Origin evil, valid sig) -> $(curl -s -w ' [%{http_code}]' -H 'Origin: https://evil.example' -H "$JH" -H "Stripe-Signature: t=$T,v1=$GOOD" --data-binary "$EV" $B/stripe/webhook)"

hr "real payment path: Stripe marks the subscription active, signed checkout.session.completed arrives"
curl -s -X POST "$F/_ctl/sub?id=$SUBA&status=active" >/dev/null
EV2='{"id":"evt_3","type":"checkout.session.completed","data":{"object":{"id":"'$CSA'","mode":"subscription","subscription":"'$SUBA'"}}}'
T=$(NOW); echo "webhook -> $(whk $SECRET $T "$EV2")"; st | head -1; echo "after upgrade: $(usage)"
echo "replay same event -> $(whk $SECRET $T "$EV2")"
restart
echo "signup #104 while Pro -> $(pub $P $L u104@sub.dev) ; $(q $D "select locked from subscribers where email='u104@sub.dev'")"
echo "Pro user POST /billing/checkout -> $(sl -b $JA -X POST $B/billing/checkout)"
echo "nav shows Pro pill: $(curl -s -b $JA $B/lists | grep -c 'plan-pill pro')"

hr "B (who did pay) returns from Checkout before any webhook"
echo "B success URL -> $(curl -s -b $JB "$B/billing?checkout=success&session_id=$CSB" | grep -o 'class="toast[^<]*' | head -1)"; st | tail -1

hr "past_due, then cancellation"
curl -s -X POST "$F/_ctl/sub?id=$SUBA&status=past_due" >/dev/null
EV3='{"id":"evt_4","type":"customer.subscription.updated","data":{"object":{"id":"'$SUBA'"}}}'
T=$(NOW); echo "past_due webhook -> $(whk $SECRET $T "$EV3")"; st | head -1
echo "signup while past_due -> $(pub $P $L u105@sub.dev) ; $(q $D "select locked from subscribers where email='u105@sub.dev'")"
curl -s -X POST "$F/_ctl/sub?id=$SUBA&status=canceled" >/dev/null
EV4='{"id":"evt_5","type":"customer.subscription.deleted","data":{"object":{"id":"'$SUBA'"}}}'
T=$(NOW); echo "canceled webhook -> $(whk $SECRET $T "$EV4")"; st | head -1
echo "signup after cancellation -> $(pub $P $L u106@sub.dev) ; $(q $D "select locked from subscribers where email='u106@sub.dev'") ; overall $(usage)"

hr "Stripe unreachable"
kill $FPID 2>/dev/null; wait $FPID 2>/dev/null
echo "A POST /billing/checkout with Stripe down -> $(sl -b $JA -X POST $B/billing/checkout)"
echo "server log tail:"; tail -3 "$A/data/$D/server-$P.log"

hr "webhook when STRIPE_WEBHOOK_SECRET is not set (key set)"
stop_server
start $STEP $P $D STRIPE_SECRET_KEY=sk_test_fake STRIPE_API_BASE=$F
T=$(NOW); echo "signed with empty secret -> $(whk '' $T "$EV2") ; unsigned -> $(curl -s -w ' [%{http_code}]' -H "$JH" --data-binary "$EV2" $B/stripe/webhook)"
tail -2 "$A/data/$D/server-$P.log"
cleanup; trap - EXIT
sleep 0.5; netstat -ano | grep LISTENING | grep -E ":($P|$FP) " || echo "ports $P and $FP free"
