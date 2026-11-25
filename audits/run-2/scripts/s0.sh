. "$(dirname "$0")/lib.sh"
P=4200; B=http://127.0.0.1:$P
rm -rf "$A/data/s0"
start_server 0 $P s0 || exit 1
trap stop_server EXIT
hr "home + headers"
curl -s -D - -o /dev/null $B/ | tr -d '\r'
hr "create list (XSS payload in title/description)"
LOC=$(curl -s -D - -o /dev/null $B/create --data-urlencode 'title=<script>alert(1)</script>"'"'"'><img src=x onerror=alert(2)>' --data-urlencode 'description=</p><script>alert(3)</script>"><svg onload=alert(4)>' | tr -d '\r' | grep -i '^location:' | cut -d' ' -f2)
echo "Location: $LOC"
TOKEN=$(echo "$LOC" | sed -E 's#/admin/([^?]+).*#\1#')
echo "TOKEN=$TOKEN" > "$A/data/s0/vars"
hr "dashboard"
curl -s -D "$A/data/s0/dash.hdr" "$B/admin/$TOKEN" > "$A/data/s0/dash.html"; head -12 "$A/data/s0/dash.hdr" | tr -d '\r'
SLUG=$(grep -o '/w/[a-z0-9-]*' "$A/data/s0/dash.html" | head -1 | cut -d/ -f3); echo "SLUG=$SLUG"; echo "SLUG=$SLUG" >> "$A/data/s0/vars"
echo "-- raw <script / onerror / onload occurrences in dashboard (unescaped):"; grep -c -E '<script>alert|<img src=x|<svg onload' "$A/data/s0/dash.html"
echo "-- escaped title:"; grep -o '<h1>[^\n]*</h1>' "$A/data/s0/dash.html" | head -2
hr "public page"
curl -s "$B/w/$SLUG" > "$A/data/s0/pub.html"; grep -c -E '<script>alert|<img src=x|<svg onload' "$A/data/s0/pub.html"; grep -E '<title>|<h1>|class="desc"|og:' "$A/data/s0/pub.html"
hr "signup JSON ok / dup / invalid / honeypot"
for body in '{"email":"Alice@Example.com"}' '{"email":"alice@example.com"}' '{"email":"not-an-email"}' '{"email":"bot@x.co","website":"http://spam"}' '{"email":"=1+1@x.co"}' '{"email":"<b>@x.co"}'; do
  echo "POST $body -> $(curl -s -w ' [%{http_code}]' -H 'Content-Type: application/json' -H 'Accept: application/json' -d "$body" $B/w/$SLUG)"
done
hr "signup form (no JS)"
curl -s -D - -o /dev/null $B/w/$SLUG -d 'email=bob@example.com' | tr -d '\r' | grep -iE '^HTTP|^location'
curl -s -D - -o /dev/null $B/w/$SLUG -d 'email=bob@example.com' | tr -d '\r' | grep -iE '^HTTP|^location'
hr "malformed bodies"
echo "JSON null -> $(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -H 'Accept: application/json' -d 'null' $B/w/$SLUG)"
echo "JSON broken -> $(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d '{' $B/w/$SLUG)"
echo "email as object -> $(curl -s -w ' [%{http_code}]' -H 'Content-Type: application/json' -H 'Accept: application/json' -d '{"email":{"a":1}}' $B/w/$SLUG)"
head -c 20000 /dev/zero | tr '\0' 'a' > "$A/data/s0/big.txt"
echo "20KB body -> $(curl -s -o /dev/null -w '%{http_code}' --data-binary @"$A/data/s0/big.txt" $B/w/$SLUG)"
hr "rate limit (already 8 counted? continue until 429)"
for i in 1 2 3 4 5 6; do echo "n$i -> $(curl -s -w ' [%{http_code}]' -H 'Content-Type: application/json' -H 'Accept: application/json' -d "{\"email\":\"rl$i@x.co\"}" $B/w/$SLUG)"; done
hr "dashboard total + CSV"
curl -s "$B/admin/$TOKEN" | grep -o 'stat-value">[0-9]*' | head -1
curl -s -D - "$B/admin/$TOKEN/export.csv" | tr -d '\r' | sed 's/^\xEF\xBB\xBF//'
hr "edit"
curl -s -D - -o /dev/null "$B/admin/$TOKEN/edit" --data-urlencode 'title=Projet Nebula' --data-urlencode 'description=Desc v2' | tr -d '\r' | grep -iE '^HTTP|^location'
curl -s "$B/w/$SLUG" | grep -E '<h1>|class="desc"'
echo "empty title -> $(curl -s -D - -o /dev/null "$B/admin/$TOKEN/edit" -d 'title=' | tr -d '\r' | grep -iE '^HTTP|^location' | tr '\n' ' ')"
hr "delete a subscriber"
SID=$(curl -s "$B/admin/$TOKEN" | grep -o 'subscribers/[0-9]*/delete' | head -1 | cut -d/ -f2); echo "sid=$SID"
curl -s -D - -o /dev/null -X POST "$B/admin/$TOKEN/subscribers/$SID/delete" | tr -d '\r' | grep -iE '^HTTP|^location'
curl -s "$B/admin/$TOKEN" | grep -o 'stat-value">[0-9]*' | head -1
hr "access control: wrong token / no token / cross-origin POST (CSRF) / GET on POST routes"
echo "wrong token -> $(curl -s -o /dev/null -w '%{http_code}' $B/admin/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA)"
echo "/admin -> $(curl -s -o /dev/null -w '%{http_code}' $B/admin) ; /admin/ -> $(curl -s -o /dev/null -w '%{http_code}' $B/admin/)"
echo "edit with Origin evil -> $(curl -s -o /dev/null -w '%{http_code}' -H 'Origin: https://evil.example' "$B/admin/$TOKEN/edit" -d 'title=Projet Nebula')"
echo "unauth create with Origin evil -> $(curl -s -o /dev/null -w '%{http_code}' -H 'Origin: https://evil.example' "$B/create" -d 'title=spam')"
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do curl -s -o /dev/null -w '%{http_code} ' $B/create -d "title=spam$i"; done; echo " <- 12 unauth list creations in a row"
hr "static traversal"
for u in '/static/..%2f..%2fserver.js' '/static/..%5c..%5cserver.js' '/static/%2e%2e/server.js' '/static/../server.js' '/static/style.css'; do echo "$u -> $(curl -s -o /dev/null -w '%{http_code}' --path-as-is "$B$u")"; done
hr "token present in dashboard HTML (for localStorage)"
grep -o '"token":"[^"]*"' "$A/data/s0/dash.html" | sed -E 's/("token":".{6}).*/\1…"/'
hr "restart -> persistence"
stop_server; start_server 0 $P s0
curl -s "$B/admin/$TOKEN" | grep -o 'stat-value">[0-9]*' | head -1
curl -s -o /dev/null -w 'public page after restart: %{http_code}\n' "$B/w/$SLUG"
ls -la "$A/data/s0/"
stop_server; trap - EXIT
sleep 0.5; netstat -ano | grep LISTENING | grep ":$P " || echo "port $P free"
