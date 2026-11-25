. <racine>/_harness/audit/run-3/scripts/lib.sh
STEP=4; PORT=4303; FPORT=4311; D=s4
rm -rf "$AUD/data/$D"; cp -r "$AUD/data/s2" "$AUD/data/$D"
read SLUG0 TOKEN0 < "$AUD/data/s0.ids"; read LA LB < "$AUD/data/s1.ids"
JA="$AUD/data/A.jar"; JB="$AUD/data/B.jar"
F=http://127.0.0.1:$FPORT
sign() { node -e 'const c=require("node:crypto");const t=process.argv[3]||Math.floor(Date.now()/1000);const sig=c.createHmac("sha256",process.argv[1]).update(t+"."+process.argv[2]).digest("hex");console.log("t="+t+",v1="+sig)' "$@"; }
plan() { curl -s -b "$1" $B/api/me | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.stringify(JSON.parse(s).plan)))'; }
summary() { curl -s -b "$1" $B/api/lists/$2 | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const o=JSON.parse(s);const v=o.subscribers.filter(x=>x.email);console.log(JSON.stringify({total:o.total,locked:o.locked,referred:o.referred,withEmail:v.length,boost:o.list.referral_boost,sampleLocked:o.subscribers.filter(x=>x.locked).slice(0,3)}))})'; }
rows() { curl -s -b "$1" $B/api/lists/$2 | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const o=JSON.parse(s);for(const x of o.subscribers.sort((a,b)=>a.position-b.position))console.log(x.position,x.email,"refs="+x.referrals,"by="+JSON.stringify(x.referred_by),x.locked?"LOCKED":"")})'; }
sub() { curl -s -X POST $B/api/w/$1/subscribe -H 'Content-Type: application/json' -H "X-Forwarded-For: 10.$((RANDOM%250)).$((RANDOM%250)).$((RANDOM%250))" -d "{\"email\":\"$2\"${3:+,\"ref\":\"$3\"}}"; }

: > "$AUD/logs/fake-stripe.log"
( exec env PORT=$FPORT FAKE_LOG="$AUD/logs/fake-stripe.log" node "$AUD/scripts/fake-stripe.mjs" ) &
FAKE_PID=$!
( exec node -e 'require("node:http").createServer((q,r)=>r.end("LANDED ON OTHER ORIGIN "+q.headers.host+q.url)).listen(4312,"127.0.0.1")' ) &
EVIL_PID=$!
start $STEP $PORT $D STRIPE_SECRET_KEY=sk_test_fake STRIPE_PRICE_ID=price_fake STRIPE_WEBHOOK_SECRET=whsec_fake STRIPE_API_BASE=$F TRUST_PROXY=1
echo "PID=$SRV_PID FAKE_PID=$FAKE_PID EVIL_PID=$EVIL_PID"; cat "$AUD/logs/server-$STEP-$PORT.log"

echo "##### 1. UPGRADE from step-2 data"
echo "plan A: $(plan "$JA")"; echo "plan B: $(plan "$JB")"
echo "lists B: $(curl -s -b "$JB" $B/api/lists)"
echo "dashboard B: $(summary "$JB" $LB)"
echo "subscribers without ref_code: $(sql $D 'SELECT COUNT(*) n FROM subscribers WHERE ref_code IS NULL')  total: $(sql $D 'SELECT COUNT(*) n, COUNT(DISTINCT ref_code) codes FROM subscribers')"
sql $D "SELECT id,slug,referral_boost,user_id FROM lists"
echo "old public page: $(curl -s -o /dev/null -w '%{http_code}' $B/w/$LB)   old token api: $(curl -s -o /dev/null -w '%{http_code}' $B/api/d/$TOKEN0)"
echo "##### 1. regressions"
echo "new:  $(sub $LA reg1@example.com)"
echo "dup:  $(sub $LA reg1@example.com)"
echo "bad:  $(sub $LA not-an-email)"
echo "bot:  $(curl -s -X POST $B/api/w/$LA/subscribe -H 'Content-Type: application/json' -d '{"email":"bot@example.com","website":"x"}')"
req PATCH /api/lists/$LA '{"title":"Liste A v4","description":"d4"}' -b "$JA" | head -c 220; echo
for v in 3 -1 1001 2.5 '"abc"' null; do echo "boost=$v -> $(curl -s -o /dev/null -w '%{http_code}' -X PATCH -b "$JA" $B/api/lists/$LA -H 'Content-Type: application/json' -d "{\"title\":\"Liste A v4\",\"referral_boost\":$v}")"; done
echo "boost now: $(curl -s -b "$JA" $B/api/lists/$LA | jget list.referral_boost)"
curl -s -o /dev/null -X PATCH -b "$JA" $B/api/lists/$LA -H 'Content-Type: application/json' -d '{"title":"Liste A v4","referral_boost":5}'
RID=$(curl -s -b "$JA" $B/api/lists/$LA | jget subscribers.0.id)
req DELETE /api/lists/$LA/subscribers/$RID '' -b "$JA" | head -c 160; echo
echo "--- export"; curl -s -D - -b "$JA" $B/api/lists/$LA/export.csv | grep -v "^Date\|^Connection\|^Keep\|^Transfer\|^X-\|^Referrer\|^Content-Security"; echo
LD=$(curl -s -b "$JA" -X POST $B/api/lists -H 'Content-Type: application/json' -d '{"title":"to delete 4"}' | jget slug)
sub $LD x@example.com >/dev/null; req DELETE /api/lists/$LD '' -b "$JA"; echo "orphans: $(sql $D 'SELECT COUNT(*) n FROM subscribers WHERE list_id NOT IN (SELECT id FROM lists)')"

echo "##### referral: core behaviour (list R owned by A, who is Pro)"
LR=$(curl -s -b "$JA" -X POST $B/api/lists -H 'Content-Type: application/json' -d '{"title":"Referral <b>test</b>","description":"r"}' | jget slug); echo "LR=$LR"
for i in 1 2 3 4 5 6 7 8 9 10; do sub $LR u$i@example.com >/dev/null; done
R=$(sub $LR u10@example.com); echo "u10 (dup): $R"; C10=$(echo "$R" | jget ref_code)
echo "f1 joins with u10's code: $(sub $LR f1@example.com $C10)"
req GET "/api/w/$LR/status?code=$C10"
echo "--- dup signup with ref must not credit"; sub $LR u3@example.com $C10 >/dev/null; echo "u10 referrals: $(curl -s "$B/api/w/$LR/status?code=$C10" | jget referrals)"
echo "--- code from another list"; CB=$(sub $LA other-list@example.com | jget ref_code); echo "x-list: $(sub $LR xlist@example.com $CB)"; echo "owner of code referrals: $(curl -s "$B/api/w/$LA/status?code=$CB" | jget referrals)"
req GET "/api/w/$LA/status?code=$C10"
req GET "/api/w/$LR/status?code=AAAAAAAA"
req GET "/api/w/$LR/status"
echo "##### 9. referral ABUSE: attacker joins last, self-refers with fake emails"
R=$(sub $LR attacker@example.com); echo "attacker joins: $R"; CE=$(echo "$R" | jget ref_code)
for i in 1 2 3; do sub $LR fake$i@mailinator.example $CE >/dev/null; done
req GET "/api/w/$LR/status?code=$CE"
echo "--- dashboard ranking"; rows "$JA" $LR | head -6
echo "--- owner deletes one fake referee"; FID=$(curl -s -b "$JA" $B/api/lists/$LR | jget subscribers.0.id); curl -s -o /dev/null -X DELETE -b "$JA" $B/api/lists/$LR/subscribers/$FID; echo "attacker now: $(curl -s "$B/api/w/$LR/status?code=$CE")"
echo "--- owner deletes a referrer (u10): child keeps existing"; U10=$(sql $D "SELECT id FROM subscribers WHERE ref_code='$C10'" | jget 0.id); curl -s -o /dev/null -X DELETE -b "$JA" $B/api/lists/$LR/subscribers/$U10; sql $D "SELECT email,referred_by FROM subscribers WHERE email='f1@example.com'"
echo "##### 9. info leak: anyone who knows an email gets its membership, rank and referral code"
echo "$(curl -s -X POST $B/api/w/$LR/subscribe -H 'Content-Type: application/json' -d '{"email":"u1@example.com"}')"
echo "--- status endpoint rate limit (60 calls)"; for i in $(seq 1 60); do curl -s -o /dev/null -w "%{http_code}\n" "$B/api/w/$LR/status?code=guess$i"; done | sort | uniq -c
echo "--- reflected ref param"; curl -s "$B/w/$LR?ref=%3Cscript%3Ealert(1)%3C/script%3E" | grep -c "alert(1)"; curl -s "$B/w/$LR" | grep -n "<title>\|data-title"
echo "##### 2. access control with referral routes"
req GET /api/lists/$LB '' -b "$JA"
req GET /api/lists/$LB/export.csv '' -b "$JA"
req PATCH /api/lists/$LB '{"title":"x","referral_boost":1000}' -b "$JA"
req DELETE /api/lists/$LB '' -b "$JA"
BS=$(curl -s -b "$JB" $B/api/lists/$LB | jget subscribers.5.id); req DELETE /api/lists/$LR/subscribers/$BS '' -b "$JA" | head -c 60; echo; echo "B sub $BS still there: $(sql $D "SELECT COUNT(*) n FROM subscribers WHERE id=$BS")"
req GET /api/lists/$LR
req GET /api/lists/$LR/export.csv

echo "##### 5. limit + referral on free B (B: canceled)"
echo "plan B: $(plan "$JB")"
CV=$(sql $D "SELECT ref_code FROM subscribers s JOIN lists l ON l.id=s.list_id WHERE l.slug='$LB' ORDER BY s.id LIMIT 1" | jget 0.ref_code)
R=$(sub $LB lockedchild@example.com $CV); CL=$(echo "$R" | jget ref_code); echo "child of visible sub: $R"
echo "grandchild of locked: $(sub $LB lockedgrand@example.com $CL)"
echo "dashboard B: $(summary "$JB" $LB)"
echo "CSV has locked emails? $(curl -s -b "$JB" $B/api/lists/$LB/export.csv | grep -c 'lockedchild\|lockedgrand')   CSV rows: $(curl -s -b "$JB" $B/api/lists/$LB/export.csv | grep -c '@')"
echo "raw API mentions locked emails? $(curl -s -b "$JB" $B/api/lists/$LB | grep -c 'lockedchild\|lockedgrand'); /api/lists: $(curl -s -b "$JB" $B/api/lists | grep -c 'lockedchild\|lockedgrand')"
curl -s -b "$JB" $B/api/lists/$LB/export.csv | head -3
echo "--- BYPASS again at step 4: delete 2 visible, the 2 locked become readable"
for id in $(sql $D "SELECT s.id FROM subscribers s JOIN lists l ON l.id=s.list_id WHERE l.slug='$LB' ORDER BY s.id LIMIT 3" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).map(x=>x.id).join(" ")))'); do curl -s -o /dev/null -X DELETE -b "$JB" $B/api/lists/$LB/subscribers/$id; done
echo "raw API mentions locked emails now? $(curl -s -b "$JB" $B/api/lists/$LB | grep -o 'lockedchild@example.com\|lockedgrand@example.com' | sort -u | tr '\n' ' ')"
echo "plan B: $(plan "$JB")"

echo "##### 4. Stripe regression at step 4"
req POST /api/billing/checkout '' -b "$JB"
tail -1 "$AUD/logs/fake-stripe.log" | cut -c1-420
CS=$(grep -o 'cs_test_fake_[0-9]*' "$AUD/logs/fake-stripe.log" | tail -1); CS=$(curl -s -b "$JB" -X POST $B/api/billing/checkout | jget url | grep -o 'cs_test_fake_[0-9]*'); echo "CS=$CS"
req POST /api/billing/sync "{\"session_id\":\"$CS\"}" -b "$JB" | head -c 200; echo
req POST /api/billing/sync "{\"session_id\":\"$CS\"}" -b "$JA"
SUBB=$(curl -s "$F/_ctl/pay?session=$CS&status=active" | jget subscription)
EV="{\"id\":\"evt_9\",\"type\":\"customer.subscription.updated\",\"data\":{\"object\":{\"id\":\"$SUBB\"}}}"
req POST /api/stripe/webhook "$EV"
req POST /api/stripe/webhook "$EV" -H "Stripe-Signature: $(sign whsec_wrong "$EV")"
req POST /api/stripe/webhook "$EV" -H "Stripe-Signature: $(sign whsec_fake "$EV" $(( $(date +%s) - 600 )))"
echo "plan B before valid webhook: $(plan "$JB")"
req POST /api/stripe/webhook "$EV" -H "Stripe-Signature: $(sign whsec_fake "$EV")"
echo "plan B after valid webhook: $(plan "$JB")"; echo "dashboard B pro: $(summary "$JB" $LB)"
curl -s "$F/_ctl/sub?id=$SUBB&status=canceled" >/dev/null; curl -s -o /dev/null -X POST $B/api/stripe/webhook -H 'Content-Type: application/json' -H "Stripe-Signature: $(sign whsec_fake "$EV")" --data-binary "$EV"; echo "plan B after cancel: $(plan "$JB")"
echo "--- Host header poisoning of Stripe return URL"
curl -s -b "$JB" -X POST $B/api/billing/checkout -H 'Host: evil.example' -w ' HTTP %{http_code}\n'; tail -1 "$AUD/logs/fake-stripe.log" | grep -o 'success_url=[^&]*'
echo "--- Host header in CSV links"; curl -s -b "$JA" $B/api/lists/$LR/export.csv -H 'Host: evil.example' | sed -n '2p'

echo "##### 9. open redirect (tab in next)"
echo "logged-in: $(curl -s -o /dev/null -D - -b "$JA" "$B/login?next=/%09/127.0.0.1:4312/phish" | grep -i '^location' | cat -A)"
SID=$(grep sid "$JA" | awk '{print $7}')
node -e 'fetch(process.argv[1],{headers:{cookie:"sid="+process.argv[2]},redirect:"follow"}).then(async r=>console.log("fetch followed redirect to:",r.url,"| body:",await r.text()))' "$B/login?next=/%09/127.0.0.1:4312/phish" "$SID"
echo "logged-in with %0a: HTTP $(curl -s -o /dev/null -w '%{http_code}' -b "$JA" "$B/login?next=/%0a/evil.example")"
node -e 'fetch(process.argv[1]).then(async r=>{const h=await r.text();const m=h.match(/data-next="([^"]*)"/);console.log("logged-out data-next =",JSON.stringify(m[1]),"-> location.href resolves to",new URL(m[1],process.argv[2]).href)})' "$B/login?next=/%0a/evil.example" "$B"
echo "##### 3. cookie Secure behind proxy"
curl -s -D - -o /dev/null -X POST $B/api/auth/login -H 'Content-Type: application/json' -H 'X-Forwarded-Proto: https' -d '{"email":"alice@example.com","password":"password"}' | grep -i set-cookie
curl -s -D - -o /dev/null -X POST $B/api/auth/login -H 'Content-Type: application/json' -d '{"email":"alice@example.com","password":"password"}' | grep -i set-cookie
echo "--- login per-IP limit bypass with X-Forwarded-For (35 attempts, distinct unknown emails, rotating XFF)"
for i in $(seq 1 35); do curl -s -o /dev/null -w "%{http_code}\n" -X POST $B/api/auth/login -H 'Content-Type: application/json' -H "X-Forwarded-For: 10.3.0.$i" -d "{\"email\":\"n$i@example.com\",\"password\":\"x\"}"; done | sort | uniq -c
echo "--- same without XFF (35 attempts)"
for i in $(seq 1 35); do curl -s -o /dev/null -w "%{http_code}\n" -X POST $B/api/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"m$i@example.com\",\"password\":\"x\"}"; done | sort | uniq -c
echo "##### headers"; curl -s -D - -o /dev/null $B/w/$LR | grep -iv "^date\|^connection\|^keep\|^transfer"
echo "##### DB"; sql $D "SELECT id,email,substr(password_hash,1,30) ph,stripe_customer_id,subscription_status FROM users"; sql $D "SELECT id,slug,substr(admin_token,1,8) tok,user_id,referral_boost FROM lists LIMIT 4"; sql $D "SELECT id,list_id,email,ref_code,referred_by FROM subscribers ORDER BY id DESC LIMIT 3"
stop; kill $FAKE_PID $EVIL_PID 2>/dev/null; wait $FAKE_PID $EVIL_PID 2>/dev/null
echo "--- server log"; cat "$AUD/logs/server-$STEP-$PORT.log"
echo "##### 7. persistence after restart"
start $STEP $PORT $D STRIPE_SECRET_KEY=sk_test_fake STRIPE_PRICE_ID=price_fake STRIPE_WEBHOOK_SECRET=whsec_fake STRIPE_API_BASE=$F
echo "PID=$SRV_PID"
echo "plan A: $(plan "$JA")"; req GET "/api/w/$LR/status?code=$CE"
stop
netstat -ano | grep -E ":43[0-4][0-9] .*LISTENING"; echo "(listeners on 4300-4349 listed above; none expected)"
