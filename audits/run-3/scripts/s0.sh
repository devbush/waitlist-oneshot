. <racine>/_harness/audit/run-3/scripts/lib.sh
rm -rf "$AUD/data/s0"
start 0 4300 s0
echo "PID=$SRV_PID"
echo "=== headers /"; curl -s -D - -o /dev/null $B/
echo "=== create list"
R=$(curl -s -X POST $B/api/lists -H 'Content-Type: application/json' -d '{"title":"Mon Projet <script>alert(1)</script>","description":"Desc \"><img src=x onerror=alert(1)>\nligne2"}'); echo "$R"
SLUG=$(echo "$R" | jget slug); TOKEN=$(echo "$R" | jget token); echo "SLUG=$SLUG TOKEN=$TOKEN"
echo "$SLUG $TOKEN" > "$AUD/data/s0.ids"
req POST /api/lists '{"title":""}'
echo "=== public page (XSS check)"; curl -s $B/w/$SLUG | grep -n "script>alert\|onerror\|<title>\|og:\|data-title\|class=\"desc\""
echo "=== subscribe"
req POST /api/w/$SLUG/subscribe '{"email":"a@example.com"}'
req POST /api/w/$SLUG/subscribe '{"email":"A@Example.com "}'
req POST /api/w/$SLUG/subscribe '{"email":"not-an-email"}'
req POST /api/w/$SLUG/subscribe '{"email":"b@example.com","website":"http://bot"}'
req POST /api/w/$SLUG/subscribe '{"email":"=cmd|calc@evil.co"}'
req POST /api/w/$SLUG/subscribe '{"email":"<img/src=x/onerror=alert(1)>@x.co"}'
req POST /api/w/$SLUG/subscribe '{"email":"c@example.com"}'
req POST /api/w/nope-000000/subscribe '{"email":"c@example.com"}'
req POST /api/w/$SLUG/subscribe 'not json'
echo "=== dashboard"
req GET /api/d/$TOKEN
req GET /api/d/wrongtoken
req GET /api/d/
echo "=== dashboard page headers"; curl -s -D - -o /dev/null $B/d/$TOKEN
echo "=== edit"
req PATCH /api/d/$TOKEN '{"title":"Titre modifie","description":"nouvelle desc"}'
req PATCH /api/d/$TOKEN '{"title":"  "}'
echo "=== delete subscriber id 1"
req DELETE /api/d/$TOKEN/subscribers/1
req DELETE /api/d/$TOKEN/subscribers/abc
echo "=== export"; curl -s -D - $B/api/d/$TOKEN/export.csv; echo
echo "=== delete list (route exists?)"
req DELETE /api/d/$TOKEN
echo "=== replaceAll pattern bug"
R2=$(curl -s -X POST $B/api/lists -H 'Content-Type: application/json' -d '{"title":"X $` Y $& Z","description":"D $` E"}'); S2=$(echo "$R2" | jget slug)
curl -s $B/w/$S2 | head -12
echo "=== path traversal static"
req GET '/static/..%2fserver.js'
req GET '/static/../server.js' '' --path-as-is
req GET /server.js
req GET /data/waitlist.db
echo "=== big body"; head -c 20000 /dev/zero | tr '\0' 'a' > "$AUD/data/big.txt"; curl -s -X POST $B/api/lists -H 'Content-Type: application/json' --data-binary @"$AUD/data/big.txt" -w '\nHTTP %{http_code}\n'
echo "=== rate limit subscribe (20/10min/IP)"
for i in $(seq 1 22); do curl -s -o /dev/null -w "%{http_code} " -X POST $B/api/w/$SLUG/subscribe -H 'Content-Type: application/json' -d "{\"email\":\"rl$i@example.com\"}"; done; echo
echo "=== rate limit create (10/h/IP)"
for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code} " -X POST $B/api/lists -H 'Content-Type: application/json' -d "{\"title\":\"rl $i\"}"; done; echo
echo "=== CORS preflight / cross origin POST"
curl -s -D - -o /dev/null -X POST $B/api/w/$SLUG/subscribe -H 'Origin: http://evil.example' -H 'Content-Type: application/json' -d '{"email":"x@example.com"}' | head -12
req GET /api/d/$TOKEN | head -5
stop
echo "=== restart: persistence"
start 0 4300 s0
req GET /api/d/$TOKEN | head -c 600; echo
stop
ls -la "$AUD/data/s0"
