. <racine>/_harness/audit/run-3/scripts/lib.sh
read LA LB < "$AUD/data/s1.ids"
JA="$AUD/data/A.jar"; JB="$AUD/data/B.jar"
F=http://127.0.0.1:4311
: > "$AUD/logs/fake-stripe2.log"
( exec env PORT=4311 FAKE_LOG="$AUD/logs/fake-stripe2.log" node "$AUD/scripts/fake-stripe.mjs" ) &
FAKE_PID=$!
start 4 4303 s4 STRIPE_SECRET_KEY=sk_test_fake STRIPE_PRICE_ID=price_fake STRIPE_WEBHOOK_SECRET=whsec_fake STRIPE_API_BASE=$F
echo "PID=$SRV_PID FAKE_PID=$FAKE_PID"
SIDB=$(grep sid "$JB" | awk '{print $7}'); SIDA=$(grep sid "$JA" | awk '{print $7}')
echo "##### Host header -> Stripe success_url (step 4, APP_URL unset)"
curl -s -X POST $B/api/billing/checkout -H "Cookie: sid=$SIDB" -H 'Host: evil.example' -w ' HTTP %{http_code}\n'
tail -1 "$AUD/logs/fake-stripe2.log" | grep -o 'success_url=[^&]*'
echo "##### Host header -> CSV referral links"
LR=$(curl -s -b "$JA" $B/api/lists | jget lists.0.slug)
curl -s $B/api/lists/$LR/export.csv -H "Cookie: sid=$SIDA" -H 'Host: evil.example' | sed -n '2p'
echo "##### SQLi probes"
req POST /api/w/$LR/subscribe "{\"email\":\"a'--@x.co\"}"
req GET "/api/w/$LR/status?code=%27%20OR%201%3D1--"
req GET "/api/lists/%27%20OR%20%271%27%3D%271" '' -b "$JA"
req POST /api/auth/login "{\"email\":\"' OR 1=1--@x.co\",\"password\":\"x\"}"
echo "##### signup rate limit (10/h/IP) + password length"
req POST /api/auth/signup "{\"email\":\"long@example.com\",\"password\":\"$(head -c 201 /dev/zero | tr '\0' 'a')\"}" | tail -2
for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code} " -X POST $B/api/auth/signup -H 'Content-Type: application/json' -d "{\"email\":\"spam$i@example.com\",\"password\":\"12345678\"}"; done; echo
echo "##### unauth reachability map (step 4)"
for p in / /login /signup /app /app/billing /app/lists/$LB /w/$LB /static/styles.css /static/dashboard.js /api/me /api/lists /api/lists/$LB /api/lists/$LB/export.csv "/api/w/$LB/status?code=x" /d/abc /data/waitlist.db /server.js /README.md /package.json /.gitignore; do echo "$(curl -s -o /dev/null -w '%{http_code}' "$B$p")  $p"; done
for p in /api/billing/checkout /api/billing/sync /api/billing/portal /api/lists /api/lists/claim /api/auth/logout; do echo "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B$p")  POST $p"; done
stop; kill $FAKE_PID 2>/dev/null; wait $FAKE_PID 2>/dev/null

echo "##### step 2: open redirect + malformed cookie (same code path as step 1)"
start 2 4302 s2
SIDA=$(grep sid "$JA" | awk '{print $7}')
echo "PID=$SRV_PID"
echo "logged-in: $(curl -s -o /dev/null -D - -H "Cookie: sid=$SIDA" "$B/login?next=/%09/evil.example" | grep -i '^location' | cat -A)"
echo "malformed cookie: HTTP $(curl -s -o /dev/null -w '%{http_code}' -H 'Cookie: sid=%E0%A4%A' $B/app)"
stop
echo "##### tests"
cd "$AUD/step-4" && npm test 2>&1 | head -8
netstat -ano | grep -E ":43[0-4][0-9] .*LISTENING"; echo "(listeners on 4300-4349 listed above; none expected)"
