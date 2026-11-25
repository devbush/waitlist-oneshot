. <racine>/_harness/audit/run-3/scripts/lib.sh
STEP=${STEP:-2}; PORT=${PORT:-4302}; FPORT=${FPORT:-4310}; D=${D:-s2}; SRC=${SRC:-s1}
rm -rf "$AUD/data/$D"; cp -r "$AUD/data/$SRC" "$AUD/data/$D"
read SLUG0 TOKEN0 < "$AUD/data/s0.ids"; read LA LB < "$AUD/data/s1.ids"
JA="$AUD/data/A.jar"; JB="$AUD/data/B.jar"
F=http://127.0.0.1:$FPORT
sign() { node -e 'const c=require("node:crypto");const t=process.argv[3]||Math.floor(Date.now()/1000);const sig=c.createHmac("sha256",process.argv[1]).update(t+"."+process.argv[2]).digest("hex");console.log("t="+t+",v1="+sig)' "$@"; }
plan() { curl -s -b "$1" $B/api/me | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.stringify(JSON.parse(s).plan)))'; }
summary() { curl -s -b "$1" $B/api/lists/$2 | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const o=JSON.parse(s);const v=o.subscribers.filter(x=>x.email);console.log(JSON.stringify({total:o.total,locked:o.locked,withEmail:v.length,newestVisible:v[0]?.email,sampleLocked:o.subscribers.find(x=>x.locked)}))})'; }

echo "##### A. step-$STEP on step-1 data, NO Stripe env"
start $STEP $PORT $D
echo "PID=$SRV_PID"; cat "$AUD/logs/server-$STEP-$PORT.log"
echo "--- old sessions/users survive migration"; req GET /api/me '' -b "$JA"; req GET /api/me '' -b "$JB"
curl -s -b "$JA" $B/api/lists | head -c 500; echo
req POST /api/billing/checkout '' -b "$JB"
req POST /api/billing/sync '{"session_id":"cs_test_x"}' -b "$JB"
echo "--- webhook with no secret configured, forged body"
req POST /api/stripe/webhook '{"type":"customer.subscription.updated","data":{"object":{"id":"sub_x"}}}'
SIG=$(sign "" '{"type":"x"}'); req POST /api/stripe/webhook '{"type":"x"}' -H "Stripe-Signature: $SIG"
echo "--- regressions: subscribe/dup/invalid/edit/export"
req POST /api/w/$LB/subscribe '{"email":"s2new@example.com"}'
req POST /api/w/$LB/subscribe '{"email":"s2new@example.com"}'
req POST /api/w/$LB/subscribe '{"email":"nope"}'
req PATCH /api/lists/$LB '{"title":"Liste B v2","description":"d2"}' -b "$JB" | head -c 200; echo
curl -s -b "$JB" $B/api/lists/$LB/export.csv; echo
echo "--- access control spot check (A on B)"; req GET /api/lists/$LB '' -b "$JA"; req GET /api/lists/$LB/export.csv '' -b "$JA"
stop

echo; echo "##### B. billing ON with fake keys + local fake Stripe"
: > "$AUD/logs/fake-stripe.log"
( exec env PORT=$FPORT FAKE_LOG="$AUD/logs/fake-stripe.log" node "$AUD/scripts/fake-stripe.mjs" ) &
FAKE_PID=$!
start $STEP $PORT $D STRIPE_SECRET_KEY=sk_test_fake STRIPE_PRICE_ID=price_fake STRIPE_WEBHOOK_SECRET=whsec_fake STRIPE_API_BASE=$F TRUST_PROXY=1
echo "PID=$SRV_PID FAKE_PID=$FAKE_PID"; cat "$AUD/logs/server-$STEP-$PORT.log"
echo "plan A: $(plan "$JA")"; echo "plan B: $(plan "$JB")"
echo "--- seed 120 subscribers on B's list (X-Forwarded-For rotated, TRUST_PROXY=1)"
for i in $(seq 1 120); do curl -s -o /dev/null -w "%{http_code}\n" -X POST $B/api/w/$LB/subscribe -H 'Content-Type: application/json' -H "X-Forwarded-For: 10.1.$((i/200)).$((i%200+1))" -d "{\"email\":\"seed$i@example.com\"}"; done | sort | uniq -c
echo "--- same IP without spoofing: 25 requests"
for i in $(seq 1 25); do curl -s -o /dev/null -w "%{http_code}\n" -X POST $B/api/w/$LB/subscribe -H 'Content-Type: application/json' -d "{\"email\":\"same$i@example.com\"}"; done | sort | uniq -c
echo "--- 30 concurrent signups"
seq 1 30 | xargs -P 30 -I{} curl -s -o /dev/null -w "%{http_code}\n" -X POST $B/api/w/$LB/subscribe -H 'Content-Type: application/json' -H "X-Forwarded-For: 10.9.0.{}" -d '{"email":"conc{}@example.com"}' | sort | uniq -c
echo "--- 20 concurrent signups of the SAME email"
seq 1 20 | xargs -P 20 -I{} curl -s -o /dev/null -w "%{http_code}\n" -X POST $B/api/w/$LB/subscribe -H 'Content-Type: application/json' -H "X-Forwarded-For: 10.8.0.{}" -d '{"email":"race@example.com"}' | sort | uniq -c
echo "public page count: $(curl -s $B/w/$LB | grep -o '<strong>[^<]*</strong> personnes')"
echo "##### 5. limit enforcement for free B"
echo "plan B: $(plan "$JB")"
echo "dashboard B: $(summary "$JB" $LB)"
echo "lists B: $(curl -s -b "$JB" $B/api/lists)"
echo "CSV rows (excluding header): $(curl -s -b "$JB" $B/api/lists/$LB/export.csv | tail -n +2 | wc -l)"
echo "CSV contains a locked email (conc5)? $(curl -s -b "$JB" $B/api/lists/$LB/export.csv | grep -c 'conc5@')"
echo "plan A (other account, own quota): $(plan "$JA")"
echo "--- second list on same account shares the quota"
LB2=$(curl -s -b "$JB" -X POST $B/api/lists -H 'Content-Type: application/json' -d '{"title":"B second list"}' | jget slug)
req POST /api/w/$LB2/subscribe '{"email":"second-list@example.com"}' -H 'X-Forwarded-For: 10.7.0.1'
echo "dashboard B list2: $(summary "$JB" $LB2)"

echo "##### 4. Stripe flows"
req PATCH /api/me '{"plan":"pro"}' -b "$JB"
req POST /api/billing/upgrade '' -b "$JB"
req POST /api/billing/checkout '' -H 'X-Forwarded-For: 10.6.0.1'
req POST /api/billing/checkout '' -b "$JB"
echo "--- what the app sent to (fake) Stripe:"; cat "$AUD/logs/fake-stripe.log"
CS_B=$(grep -o 'cs_test_fake_[0-9]*' "$AUD/logs/fake-stripe.log" | tail -1); [ -z "$CS_B" ] && CS_B=$(curl -s -b "$JB" -X POST $B/api/billing/checkout | jget url | grep -o 'cs_test_fake_[0-9]*')
echo "CS_B=$CS_B"
echo "--- success URL page alone"; curl -s -o /dev/null -w "%{http_code}\n" -b "$JB" "$B/app/billing?checkout=success&session_id=cs_test_whatever"; echo "plan B: $(plan "$JB")"
echo "--- sync with bad ids"
req POST /api/billing/sync '{"session_id":"foo"}' -b "$JB"
req POST /api/billing/sync '{"session_id":"cs_test_doesnotexist"}' -b "$JB"
req POST /api/billing/sync '{"session_id":"cs_/../../subscriptions/sub_x"}' -b "$JB"
echo "--- sync with own UNPAID session"
req POST /api/billing/sync "{\"session_id\":\"$CS_B\"}" -b "$JB"
echo "--- A creates and (fake) pays a session; B tries to sync A's paid session"
CS_A=$(curl -s -b "$JA" -X POST $B/api/billing/checkout | jget url | grep -o 'cs_test_fake_[0-9]*'); echo "CS_A=$CS_A"
SUB_A=$(curl -s "$F/_ctl/pay?session=$CS_A&status=active" | jget subscription); echo "SUB_A=$SUB_A"
req POST /api/billing/sync "{\"session_id\":\"$CS_A\"}" -b "$JB"
echo "plan B: $(plan "$JB")"; echo "plan A (before its own sync): $(plan "$JA")"
echo "--- B's own session, subscription status incomplete (payment not completed)"
SUB_B=$(curl -s "$F/_ctl/pay?session=$CS_B&status=incomplete" | jget subscription); echo "SUB_B=$SUB_B"
req POST /api/billing/sync "{\"session_id\":\"$CS_B\"}" -b "$JB"
echo "##### webhook signature"
EV="{\"id\":\"evt_1\",\"type\":\"customer.subscription.updated\",\"data\":{\"object\":{\"id\":\"$SUB_B\",\"status\":\"active\",\"customer\":\"cus_whatever\"}}}"
echo "--- no signature (event body claims active)"; req POST /api/stripe/webhook "$EV"
echo "--- wrong secret"; req POST /api/stripe/webhook "$EV" -H "Stripe-Signature: $(sign whsec_wrong "$EV")"
echo "--- right secret, timestamp 10 min old"; req POST /api/stripe/webhook "$EV" -H "Stripe-Signature: $(sign whsec_fake "$EV" $(( $(date +%s) - 600 )))"
echo "--- right secret, signature over different body"; req POST /api/stripe/webhook "$EV" -H "Stripe-Signature: $(sign whsec_fake '{}')"
echo "plan B: $(plan "$JB")"
echo "--- VALID signature, event body claims active but Stripe says incomplete"; req POST /api/stripe/webhook "$EV" -H "Stripe-Signature: $(sign whsec_fake "$EV")"
echo "plan B: $(plan "$JB")"
echo "--- now Stripe says active; valid webhook"
curl -s "$F/_ctl/sub?id=$SUB_B&status=active" >/dev/null
req POST /api/stripe/webhook "$EV" -H "Stripe-Signature: $(sign whsec_fake "$EV")"
echo "plan B: $(plan "$JB")"
echo "dashboard B (pro): $(summary "$JB" $LB)"
echo "CSV rows (pro): $(curl -s -b "$JB" $B/api/lists/$LB/export.csv | tail -n +2 | wc -l)"
req POST /api/billing/checkout '' -b "$JB"
req POST /api/billing/portal '' -b "$JB"
echo "--- past_due"
curl -s "$F/_ctl/sub?id=$SUB_B&status=past_due" >/dev/null
req POST /api/stripe/webhook "$EV" -H "Stripe-Signature: $(sign whsec_fake "$EV")" >/dev/null; echo "plan B past_due: $(plan "$JB")"
echo "--- cancellation"
curl -s "$F/_ctl/sub?id=$SUB_B&status=canceled" >/dev/null
EVD="{\"id\":\"evt_2\",\"type\":\"customer.subscription.deleted\",\"data\":{\"object\":{\"id\":\"$SUB_B\"}}}"
req POST /api/stripe/webhook "$EVD" -H "Stripe-Signature: $(sign whsec_fake "$EVD")"
echo "plan B: $(plan "$JB")"; echo "dashboard B (free again): $(summary "$JB" $LB)"
echo "--- valid signature, malformed JSON / missing type"
req POST /api/stripe/webhook 'not json' -H "Stripe-Signature: $(sign whsec_fake 'not json')"
req POST /api/stripe/webhook '{}' -H "Stripe-Signature: $(sign whsec_fake '{}')"
echo "--- A syncs its own paid session"
req POST /api/billing/sync "{\"session_id\":\"$CS_A\"}" -b "$JA"

echo "##### 5. BYPASS: free B deletes visible subscribers to reveal locked ones"
BEFORE=$(curl -s -b "$JB" $B/api/lists/$LB)
echo "$BEFORE" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const o=JSON.parse(s);const locked=o.subscribers.filter(x=>x.locked).map(x=>x.id);const vis=o.subscribers.filter(x=>!x.locked).map(x=>x.id);console.log("locked ids:",locked.length,"visible ids:",vis.length);require("fs").writeFileSync(process.argv[1],vis.slice(-locked.length).join("\n"));require("fs").writeFileSync(process.argv[2],locked.join(","))})' "$AUD/data/$D.del" "$AUD/data/$D.locked"
curl -s -b "$JB" $B/api/lists/$LB/export.csv > "$AUD/data/$D.export1.csv"; echo "export #1 rows: $(tail -n +2 "$AUD/data/$D.export1.csv" | wc -l)"
for id in $(cat "$AUD/data/$D.del"); do curl -s -o /dev/null -X DELETE -b "$JB" $B/api/lists/$LB/subscribers/$id; done
echo "after deleting $(wc -l < "$AUD/data/$D.del" | tr -d ' ')+1 oldest visible: $(summary "$JB" $LB)"
curl -s -b "$JB" $B/api/lists/$LB/export.csv > "$AUD/data/$D.export2.csv"; echo "export #2 rows: $(tail -n +2 "$AUD/data/$D.export2.csv" | wc -l)"
echo "distinct emails across both exports: $(cat "$AUD/data/$D.export1.csv" "$AUD/data/$D.export2.csv" | grep -o '[^",]*@[^",]*' | sort -u | wc -l)"
echo "plan B (still free): $(plan "$JB")"
echo "--- DB billing columns"; sql $D "SELECT id,email,stripe_customer_id,subscription_id,subscription_status,current_period_end,cancel_at_period_end FROM users"
echo "--- host header in success_url"
curl -s -o /dev/null -b "$JB" -X POST $B/api/billing/checkout -H 'Host: evil.example'; tail -1 "$AUD/logs/fake-stripe.log" | grep -o 'success_url=[^&]*'
stop; kill $FAKE_PID 2>/dev/null; wait $FAKE_PID 2>/dev/null
echo "--- server log"; cat "$AUD/logs/server-$STEP-$PORT.log"
echo "##### 7. persistence after restart (billing on)"
start $STEP $PORT $D STRIPE_SECRET_KEY=sk_test_fake STRIPE_PRICE_ID=price_fake STRIPE_WEBHOOK_SECRET=whsec_fake STRIPE_API_BASE=$F
echo "plan A: $(plan "$JA")"; echo "plan B: $(plan "$JB")"
stop
