. <racine>/_harness/audit/run-1/tools/lib.sh
B=http://127.0.0.1:4100; DB=$A/data/s0/waitlist.db
rm -rf $A/data/s0
start_server 0 4100 $DB
J='-H Content-Type:application/json'
echo "== create list"
R=$(curl -s -X POST $B/api/lists $J -d '{"title":"Projet <script>alert(1)</script>","description":"Desc <img src=x onerror=alert(1)>\n\nP2"}'); echo "$R"
SLUG=$(echo "$R" | jget slug); TOK=$(echo "$R" | jget adminToken)
echo "== public page (escaping)"
curl -s -D - $B/w/$SLUG | grep -iE "^HTTP|content-security|x-frame|x-content|referrer|strict-transport|<title>|wl-title|wl-desc|set-cookie" | cut -c1-300
echo "== signup"
req POST $B/api/w/$SLUG/subscribe $J -d '{"email":"alice@example.com"}'
req POST $B/api/w/$SLUG/subscribe $J -d '{"email":"Alice@Example.com"}'
req POST $B/api/w/$SLUG/subscribe $J -d '{"email":"not-an-email"}'
req POST $B/api/w/$SLUG/subscribe $J -d '{"email":"=cmd|calc@evil.co"}'
req POST $B/api/w/$SLUG/subscribe $J -d '{"email":"\"><svg/onload=alert(1)>@x.co"}'
req POST $B/api/w/$SLUG/subscribe $J -d '{"email":"a<b>@x.co"}'
echo "== form post no JS"
curl -s -X POST $B/w/$SLUG -d 'email=bob%40example.com' -w '\nHTTP %{http_code}\n' | grep -E "data-position|HTTP|success-title"
curl -s -X POST $B/w/$SLUG --data-urlencode 'email="><script>alert(1)</script>' -w '\nHTTP %{http_code}\n' | grep -E 'value="|HTTP|wl-error'
echo "== dashboard"
req GET $B/api/admin/$TOK
req GET $B/admin/$TOK -o /dev/null
req GET $B/api/admin/wrongtoken
req GET $B/admin/wrongtoken -o /dev/null
echo "== edit"
req PATCH $B/api/admin/$TOK $J -d '{"title":"Nouveau titre"}'
req PATCH $B/api/admin/$TOK $J -d '{"title":"  "}'
echo "== export"
req GET $B/api/admin/$TOK/export.csv -D -
echo "== delete subscriber 1 then recheck"
req DELETE $B/api/admin/$TOK/subscribers/1
req DELETE $B/api/admin/$TOK/subscribers/999
echo "== summary endpoint (token oracle?)"
req POST $B/api/lists/summary $J -d "{\"tokens\":[\"$TOK\",\"x\"]}"
echo "== no-auth list enumeration attempts"
req GET $B/api/lists
req GET $B/api/admin/
req GET "$B/static/..%2fserver.js" -o /dev/null
req GET "$B/static/../server.js" --path-as-is -o /dev/null
req GET "$B/static/..%5cserver.js" --path-as-is -o /dev/null
req GET "$B/static/dashboard.html" -o /dev/null
echo "== restart persistence"
stop_pid $LAST_PID
start_server 0 4100 $DB
req GET $B/api/admin/$TOK
echo "== rate limit subscribe (25 rapid)"
for i in $(seq 1 25); do curl -s -o /dev/null -w '%{http_code} ' -X POST $B/api/w/$SLUG/subscribe $J -d "{\"email\":\"rl$i@example.com\"}"; done; echo
echo "== CSRF: cross-origin POST create + DELETE with token"
req POST $B/api/lists $J -H 'Origin: https://evil.example' -d '{"title":"csrf"}'
echo "== malformed"
req POST $B/api/lists -H 'Content-Type: text/plain' -d 'x'
req POST $B/api/lists $J -d '{bad'
req GET "$B//" -o /dev/null
echo "== token in DB plain?"
node -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1]);console.log(d.prepare("select id,slug,admin_token from lists").all())' "$(cygpath -w $DB)"
echo "TOK=$TOK SLUG=$SLUG" > $A/data/s0/ids.txt
stop_all
ls -la $A/data/s0
