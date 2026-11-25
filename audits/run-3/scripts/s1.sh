. <racine>/_harness/audit/run-3/scripts/lib.sh
rm -rf "$AUD/data/s1"; cp -r "$AUD/data/s0" "$AUD/data/s1"
read SLUG0 TOKEN0 < "$AUD/data/s0.ids"
JA="$AUD/data/A.jar"; JB="$AUD/data/B.jar"; rm -f "$JA" "$JB"
start 1 4301 s1
echo "PID=$SRV_PID"
echo "##### 1. UPGRADE from step-0 data"
req GET /api/d/$TOKEN0
req GET /api/d/$TOKEN0/export.csv
echo "--- /d/token unauth"; curl -s -D - -o /dev/null $B/d/$TOKEN0 | head -3
echo "--- old public page"; curl -s -o /dev/null -w "%{http_code}\n" $B/w/$SLUG0; curl -s $B/w/$SLUG0 | grep -n "social-proof" -A2 | head -4
req POST /api/w/$SLUG0/subscribe '{"email":"after-upgrade@example.com"}'
req POST /api/w/$SLUG0/subscribe '{"email":"c@example.com"}'
echo "--- step-0 style create without account"; req POST /api/lists '{"title":"anon"}'
echo "##### signup A and B"
curl -s -D - -c "$JA" -X POST $B/api/auth/signup -H 'Content-Type: application/json' -d '{"email":"Alice@Example.com","password":"password"}'; echo
curl -s -c "$JB" -X POST $B/api/auth/signup -H 'Content-Type: application/json' -d '{"email":"bob@example.com","password":"bobbobbob1"}'; echo
req POST /api/auth/signup '{"email":"alice@example.com","password":"whatever12"}'
req POST /api/auth/signup '{"email":"short@example.com","password":"1234567"}'
req POST /api/auth/signup '{"email":"bad","password":"12345678"}'
req GET /api/me '' -b "$JA"
req GET /api/lists '' -b "$JA"
echo "##### legacy list before claim: B reads by slug"
req GET /api/lists/$SLUG0 '' -b "$JB"
echo "--- A claims via /d/token"; curl -s -D - -o /dev/null -b "$JA" $B/d/$TOKEN0 | head -3
echo "--- B tries /d/token after A claimed"; curl -s -o /dev/null -w "%{http_code}\n" -b "$JB" $B/d/$TOKEN0
req POST /api/lists/claim "{\"token\":\"$TOKEN0\"}" -b "$JB"
req GET /api/lists '' -b "$JA"
echo "--- A dashboard of legacy list (total)"; curl -s -b "$JA" $B/api/lists/$SLUG0 | head -c 400; echo
echo "##### A and B create lists"
LA=$(curl -s -b "$JA" -X POST $B/api/lists -H 'Content-Type: application/json' -d '{"title":"Liste A","description":"da"}' | jget slug)
LB=$(curl -s -b "$JB" -X POST $B/api/lists -H 'Content-Type: application/json' -d '{"title":"Liste B secrete","description":"db"}' | jget slug)
echo "LA=$LA LB=$LB"; echo "$LA $LB" > "$AUD/data/s1.ids"
req POST /api/w/$LB/subscribe '{"email":"bsub1@example.com"}'
req POST /api/w/$LB/subscribe '{"email":"bsub2@example.com"}'
req POST /api/w/$LA/subscribe '{"email":"asub1@example.com"}'
req POST /api/w/$LA/subscribe '{"email":"asub2@example.com"}'
BSUB=$(curl -s -b "$JB" $B/api/lists/$LB | jget subscribers.0.id); echo "B subscriber id=$BSUB"
echo "##### 2. ACCESS CONTROL: A against B's list"
req GET /api/lists/$LB '' -b "$JA"
req GET /api/lists/$LB/export.csv '' -b "$JA"
req PATCH /api/lists/$LB '{"title":"pwned"}' -b "$JA"
req DELETE /api/lists/$LB/subscribers/$BSUB '' -b "$JA"
req DELETE /api/lists/$LA/subscribers/$BSUB '' -b "$JA" | head -c 300; echo
req DELETE /api/lists/$LB '' -b "$JA"
echo "--- page /app/lists/LB as A"; curl -s -o /dev/null -w "%{http_code}\n" -b "$JA" $B/app/lists/$LB
BTOK=$(sql s1 "SELECT admin_token FROM lists WHERE slug='$LB'" | jget 0.admin_token); echo "B admin_token (from DB)=$BTOK"
req POST /api/lists/claim "{\"token\":\"$BTOK\"}" -b "$JA"
echo "--- /d/BTOK as A"; curl -s -o /dev/null -w "%{http_code}\n" -b "$JA" $B/d/$BTOK
req GET /api/d/$BTOK '' -b "$JA"
echo "--- B's list intact?"; curl -s -b "$JB" $B/api/lists/$LB; echo
echo "##### unauthenticated"
req GET /api/lists
req GET /api/me
req GET /api/lists/$LB
req GET /api/lists/$LB/export.csv
req DELETE /api/lists/$LB
for p in /app /app/lists/$LB /d/$BTOK; do curl -s -o /dev/null -w "$p -> %{http_code} %{redirect_url}\n" $B$p; done
echo "##### 1. regressions as A"
req PATCH /api/lists/$LA '{"title":"Liste A v2","description":"new"}' -b "$JA" | head -c 250; echo
ASUB=$(curl -s -b "$JA" $B/api/lists/$LA | jget subscribers.0.id)
req DELETE /api/lists/$LA/subscribers/$ASUB '' -b "$JA" | head -c 300; echo
echo "--- export"; curl -s -b "$JA" $B/api/lists/$LA/export.csv; echo
echo "--- pages"; for p in /app /app/lists/$LA /w/$LA; do curl -s -o /dev/null -w "$p -> %{http_code}\n" -b "$JA" $B$p; done
LA2=$(curl -s -b "$JA" -X POST $B/api/lists -H 'Content-Type: application/json' -d '{"title":"to delete"}' | jget slug)
req POST /api/w/$LA2/subscribe '{"email":"gone@example.com"}'
req DELETE /api/lists/$LA2 '' -b "$JA"
req GET /api/lists/$LA2 '' -b "$JA"
echo "--- public page of deleted list"; curl -s -o /dev/null -w "%{http_code}\n" $B/w/$LA2
echo "--- orphan subscribers after list delete"; sql s1 "SELECT COUNT(*) n FROM subscribers WHERE list_id NOT IN (SELECT id FROM lists)"
echo "##### 9. CSRF"
req POST /api/lists '{"title":"csrf evil origin"}' -b "$JA" -H 'Origin: http://evil.example'
req POST /api/lists '{"title":"csrf null origin"}' -b "$JA" -H 'Origin: null'
req DELETE /api/lists/$LA '' -b "$JA" -H 'Origin: http://evil.example'
echo ">>> POST text/plain no Origin"; curl -s -b "$JA" -X POST $B/api/lists -H 'Content-Type: text/plain' -d '{"title":"csrf textplain no origin"}' -w '\n<<< HTTP %{http_code}\n'
req POST /api/auth/logout '' -b "$JA" -H 'Origin: http://evil.example'
echo "##### 9. open redirect"
for n in '//evil.example' '/\evil.example' 'https://evil.example' '/%09/evil.example' '/%0a/evil.example' '/app/lists/x'; do
  echo "next=$n  logged-in -> $(curl -s -o /dev/null -D - -b "$JA" "$B/login?next=$n" | grep -i '^location' | cat -A)"
  echo "         logged-out data-next -> $(curl -s "$B/login?next=$n" | grep -o 'data-next="[^"]*"' | cat -A)"
done
echo "##### 3. sessions: malformed cookie"
req GET /api/me '' -H 'Cookie: sid=%E0%A4%A'
curl -s -o /dev/null -w "page / with malformed cookie -> %{http_code}\n" -H 'Cookie: sid=%E0%A4%A' $B/
echo "##### 3. DB storage"
sql s1 "SELECT id,email,password_hash,created_at FROM users"
sql s1 "SELECT * FROM sessions"
echo "cookie jar A:"; grep sid "$JA"
echo "##### 3. logout"
SIDA=$(grep sid "$JA" | awk '{print $7}')
curl -s -D - -b "$JA" -X POST $B/api/auth/logout | grep -i "set-cookie\|HTTP/"
req GET /api/me '' -H "Cookie: sid=$SIDA"
echo "##### 3. login + enumeration + timing"
curl -s -D - -c "$JA" -X POST $B/api/auth/login -H 'Content-Type: application/json' -d '{"email":"alice@example.com","password":"password"}' | grep -i "set-cookie\|HTTP/\|ok"
req POST /api/auth/login '{"email":"alice@example.com","password":"wrongwrong"}'
req POST /api/auth/login '{"email":"nobody@example.com","password":"wrongwrong"}'
echo "timing known-email wrong pw:"; for i in 1 2 3; do curl -s -o /dev/null -w "%{time_total} " -X POST $B/api/auth/login -H 'Content-Type: application/json' -d '{"email":"alice@example.com","password":"wrongwrong"}'; done; echo
echo "timing unknown email:"; for i in 1 2 3; do curl -s -o /dev/null -w "%{time_total} " -X POST $B/api/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"nobody$i@example.com\",\"password\":\"wrongwrong\"}"; done; echo
echo "##### 3. brute force on bob (10/15min/email)"
for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code} " -X POST $B/api/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"bob@example.com\",\"password\":\"guess$i\"}"; done; echo
echo "--- bob with CORRECT password while locked:"; req POST /api/auth/login '{"email":"bob@example.com","password":"bobbobbob1"}'
echo "--- bob's existing session still works:"; req GET /api/me '' -b "$JB"
echo "##### headers on /app (auth'd)"; curl -s -D - -o /dev/null -b "$JA" $B/app
stop
echo "##### 7. persistence after restart"
start 1 4301 s1
req GET /api/me '' -b "$JA"
curl -s -b "$JA" $B/api/lists; echo
stop
