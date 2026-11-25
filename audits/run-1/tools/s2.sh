. <racine>/_harness/audit/run-1/tools/lib.sh
STEP=${STEP:-2}; PORT=${PORT:-4102}; FP=${FP:-4110}
B=http://127.0.0.1:$PORT; D=$A/data/s$STEP-billing; DB=$D/waitlist.db
rm -rf $D; mkdir -p $D
J='-H Content-Type:application/json'
CA="-b $D/a.jar -c $D/a.jar"; CB="-b $D/b.jar -c $D/b.jar"
WH=whsec_audit_fake
webhook() { # payload [offset] [secret]
  local sig=$(node $(cygpath -m $A/tools/sign.mjs) "${3:-$WH}" "$1" "${2:-0}")
  curl -s -X POST $B/stripe/webhook -H 'Content-Type: application/json' -H "Stripe-Signature: $sig" -d "$1" -w ' <<< HTTP %{http_code}\n'
}
plan() { curl -s $B/api/billing $1 | cut -c1-300; echo; }

echo "######## PART 1: no Stripe configuration"
start_server $STEP $PORT $DB
curl -s -o /dev/null -X POST $B/api/auth/signup $J $CA -d '{"email":"a@example.com","password":"password-A-123"}'
plan "$CA"
req POST $B/api/billing/checkout $CA
req POST $B/api/billing/portal $CA
req POST $B/stripe/webhook $J -d '{"type":"checkout.session.completed"}'
req POST $B/stripe/webhook $J -H 'Stripe-Signature: t=1,v1=00' -d '{}'
stop_pid $LAST_PID

echo "######## PART 2: fake Stripe config, API base -> local fake on :$FP"
if netstat -ano | grep -qE "[:.]$FP +.*LISTENING"; then echo "PORT $FP BUSY"; exit 9; fi
FAKE_PORT=$FP FAKE_LOG=$(cygpath -m $D/fake-stripe.log) node $(cygpath -m $A/tools/fake-stripe.mjs) > $D/fake.out 2>&1 &
FPID=$!; PIDS="$PIDS $FPID"
start_server $STEP $PORT $DB TRUST_PROXY=1 STRIPE_SECRET_KEY=sk_test_fake STRIPE_PRICE_ID=price_fake_9eur STRIPE_WEBHOOK_SECRET=$WH STRIPE_API_BASE=http://127.0.0.1:$FP
curl -s -o /dev/null -X POST $B/api/auth/signup $J $CB -d '{"email":"b@example.com","password":"password-B-123"}'
echo "== unauth billing routes"
req GET $B/api/billing
req POST $B/api/billing/checkout
req POST $B/api/billing/portal
echo "== plan A (free)"; plan "$CA"
echo "== checkout A"
req POST $B/api/billing/checkout $CA
echo "-- what the app sent to (fake) Stripe:"; cat $D/fake-stripe.log
echo "== portal before any subscription? (A has customer now)"
req POST $B/api/billing/portal $CA
req POST $B/api/billing/portal $CB
echo "== free-upgrade attempts without paying"
curl -s -o /dev/null -w 'GET /app?billing=success -> %{http_code}\n' "$B/app?billing=success&session_id=cs_test_fake" $CA
plan "$CA"
req GET "$B/api/billing?plan=pro" $CA -o /dev/null
req POST $B/api/billing $J $CA -d '{"plan":"pro"}'
req PATCH $B/api/billing $J $CA -d '{"plan":"pro","subscription_status":"active"}'
req PUT $B/api/auth/me $J $CA -d '{"subscription_status":"active"}'
req POST $B/api/auth/signup $J -d '{"email":"mass@example.com","password":"password-123","subscription_status":"active","plan":"pro","stripe_customer_id":"cus_fake_1"}'
curl -s -o /dev/null -X POST $B/api/auth/login $J -c $D/m.jar -d '{"email":"mass@example.com","password":"password-123"}'; plan "-b $D/m.jar"
echo "== webhook forgery"
EV='{"id":"evt_1","type":"checkout.session.completed","data":{"object":{"mode":"subscription","subscription":"sub_A","client_reference_id":"1","customer":"cus_fake_1"}}}'
curl -s -X POST $B/stripe/webhook $J -d "$EV" -w ' <<< HTTP %{http_code} (no signature)\n'
curl -s -X POST $B/stripe/webhook $J -H 'Stripe-Signature: t=1795000000,v1=deadbeef' -d "$EV" -w ' <<< HTTP %{http_code} (garbage sig)\n'
echo -n "wrong secret: "; webhook "$EV" 0 whsec_wrong
echo -n "empty secret: "; webhook "$EV" 0 ""
echo -n "right secret, t 10 min old: "; webhook "$EV" -600
echo -n "right secret, t 10 min future: "; webhook "$EV" 600
echo -n "v1 missing (v0 only): "; SIG=$(node $(cygpath -m $A/tools/sign.mjs) $WH "$EV"); curl -s -X POST $B/stripe/webhook $J -H "Stripe-Signature: ${SIG/v1=/v0=}" -d "$EV" -w ' <<< HTTP %{http_code}\n'
echo -n "valid sig but tampered body: "; curl -s -X POST $B/stripe/webhook $J -H "Stripe-Signature: $SIG" -d "${EV/sub_A/sub_B}" -w ' <<< HTTP %{http_code}\n'
plan "$CA"
echo "== valid signed event but Stripe says the subscription is NOT paid (incomplete)"
curl -s -X POST http://127.0.0.1:$FP/__set -d '{"id":"sub_A","customer":"cus_fake_1","status":"incomplete","current_period_end":1900000000}' >/dev/null
echo -n "signed: "; webhook "$EV"; plan "$CA"
echo "== valid signed event, subscription active at Stripe -> Pro"
curl -s -X POST http://127.0.0.1:$FP/__set -d '{"id":"sub_A","customer":"cus_fake_1","status":"active","current_period_end":1900000000}' >/dev/null
echo -n "signed: "; webhook "$EV"; plan "$CA"
echo "-- B unaffected?"; plan "$CB"
echo "== checkout again while Pro"
req POST $B/api/billing/checkout $CA
echo "== signed event whose client_reference_id points at B but the sub belongs to A's customer"
EVB='{"id":"evt_2","type":"checkout.session.completed","data":{"object":{"mode":"subscription","subscription":"sub_A","client_reference_id":"2"}}}'
echo -n "signed: "; webhook "$EVB"; plan "$CB"
echo "== cancel: Stripe says canceled -> back to free"
curl -s -X POST http://127.0.0.1:$FP/__set -d '{"id":"sub_A","customer":"cus_fake_1","status":"canceled","current_period_end":1900000000}' >/dev/null
echo -n "signed deleted: "; webhook '{"id":"evt_3","type":"customer.subscription.deleted","data":{"object":{"id":"sub_A"}}}'; plan "$CA"
echo "== past_due counts as Pro?"
curl -s -X POST http://127.0.0.1:$FP/__set -d '{"id":"sub_A","customer":"cus_fake_1","status":"past_due","current_period_end":1900000000}' >/dev/null
echo -n "signed updated: "; webhook '{"id":"evt_4","type":"customer.subscription.updated","data":{"object":{"id":"sub_A"}}}'; plan "$CA"
curl -s -X POST http://127.0.0.1:$FP/__set -d '{"id":"sub_A","customer":"cus_fake_1","status":"canceled"}' >/dev/null
webhook '{"id":"evt_5","type":"customer.subscription.updated","data":{"object":{"id":"sub_A"}}}' >/dev/null; plan "$CA"
echo "== Stripe down during webhook (unknown sub -> fake returns 404)"
echo -n "signed: "; webhook '{"id":"evt_6","type":"customer.subscription.updated","data":{"object":{"id":"sub_unknown"}}}'
echo "== users table (billing columns)"
node --disable-warning=ExperimentalWarning -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1]);console.log(JSON.stringify(d.prepare("select id,email,stripe_customer_id,stripe_subscription_id,subscription_status,current_period_end,cancel_at_period_end from users").all()))' "$(cygpath -m $DB)"
stop_all
echo "== fake stripe request log"; cat $D/fake-stripe.log | cut -c1-400
