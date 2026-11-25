. "$(dirname "$0")/lib.sh"
export MSYS_NO_PATHCONV=1
P=4201; B=http://127.0.0.1:$P; D=s1
rm -rf "$A/data/$D"; mkdir -p "$A/data/$D"
trap stop_server EXIT
start_server 1 $P $D || exit 1
trap stop_server EXIT
JA="$AW/data/$D/a.jar"; JB="$AW/data/$D/b.jar"

hr "unauthenticated reach"
for u in / /lists /lists/foo /lists/foo/export.csv /login /signup /admin/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA /create; do echo "GET $u -> $(sl $B$u)"; done
echo "POST /create -> $(code -X POST $B/create -d title=x)   POST /lists -> $(sl $B/lists -d title=x)"

hr "signup A and B, cookie flags"
echo "weak pw 7 chars -> $(code $B/signup -d 'email=a@test.dev&password=1234567')"
echo "A (password='password') -> $(sl -c $JA $B/signup -d 'email=a@test.dev&password=password')"
echo "B -> $(sl -c $JB $B/signup -d 'email=b@test.dev&password=passwordB1')"
echo "signup with X-Forwarded-Proto https -> $(sl -H 'X-Forwarded-Proto: https' $B/signup -d 'email=c@test.dev&password=passwordC1')"
echo "dup signup (enumeration) -> $(curl -s -w ' [%{http_code}]' $B/signup -d 'email=a@test.dev&password=whatever1' | grep -o -E 'class="alert error"[^<]*|\[[0-9]+\]' | tr '\n' ' ')"

hr "A and B create a list each"
LA=$(sl -b $JA $B/lists --data-urlencode 'title=Liste A <script>alert(1)</script>' --data-urlencode 'description=desc A "><img src=x onerror=alert(1)>'); echo "$LA"; SA=$(echo "$LA" | grep -o '/lists/[a-z0-9-]*' | cut -d/ -f3)
LB=$(sl -b $JB $B/lists -d 'title=Liste B secrete&description=desc B'); echo "$LB"; SB=$(echo "$LB" | grep -o '/lists/[a-z0-9-]*' | cut -d/ -f3)
echo "SA=$SA SB=$SB"
for e in a1 a2 a3; do jpost $B/w/$SA "{\"email\":\"$e@sub.dev\"}" >/dev/null; done
for e in b1 b2; do jpost $B/w/$SB "{\"email\":\"$e@sub.dev\"}" >/dev/null; done
echo "A dashboard total: $(curl -s -b $JA $B/lists/$SA | grep -o 'stat-value">[0-9]*' | head -1); B: $(curl -s -b $JB $B/lists/$SB | grep -o 'stat-value">[0-9]*' | head -1)"
echo "A /lists shows B's list? $(curl -s -b $JA $B/lists | grep -c "$SB") (0 = no) ; shows own: $(curl -s -b $JA $B/lists | grep -c "$SA")"
echo "XSS unescaped in A dashboard/lists/public: $(curl -s -b $JA $B/lists/$SA | grep -c -E '<script>alert|<img src=x') $(curl -s -b $JA $B/lists | grep -c -E '<script>alert|<img src=x') $(curl -s $B/w/$SA | grep -c -E '<script>alert|<img src=x')"

hr "cross-account (A acting on B's list $SB)"
echo "GET dashboard -> $(code -b $JA $B/lists/$SB)"
echo "GET export -> $(code -b $JA $B/lists/$SB/export.csv)"
echo "POST edit -> $(code -b $JA $B/lists/$SB/edit -d 'title=HACKED')"
echo "POST delete -> $(code -b $JA $B/lists/$SB/delete -X POST)"
q $D "select id,list_id,email from subscribers"
BSUB=$(q $D "select s.id from subscribers s join lists l on l.id=s.list_id where l.slug='$SB' limit 1" | grep -o '[0-9]*')
echo "A deletes B's subscriber id=$BSUB through A's own list path -> $(sl -b $JA -X POST $B/lists/$SA/subscribers/$BSUB/delete)"
echo "A deletes B's subscriber through B's path -> $(code -b $JA -X POST $B/lists/$SB/subscribers/$BSUB/delete)"
TB=$(q $D "select admin_token from lists where slug='$SB'" | sed -E 's/.*:"(.*)".*/\1/')
echo "A uses B's legacy admin_token (read from DB) -> $(sl -b $JA $B/admin/$TB) ; /admin/TB/export.csv -> $(code -b $JA $B/admin/$TB/export.csv)"
echo "B list intact: $(q $D "select title,(select count(*) from subscribers where list_id=lists.id) n from lists where slug='$SB'")"
echo "unauth export of B -> $(sl $B/lists/$SB/export.csv)"

hr "own actions still work (regression): edit, export, delete subscriber"
echo "edit -> $(sl -b $JA $B/lists/$SA/edit -d 'title=Liste A v2&description=d2')"
curl -s -b $JA $B/lists/$SA/export.csv | tr -d '\r'; echo
ASUB=$(q $D "select s.id from subscribers s join lists l on l.id=s.list_id where l.slug='$SA' limit 1" | grep -o '[0-9]*')
echo "del sub -> $(sl -b $JA -X POST $B/lists/$SA/subscribers/$ASUB/delete) total now $(curl -s -b $JA $B/lists/$SA | grep -o 'stat-value">[0-9]*' | head -1)"
echo "dup/invalid public -> $(jpost $B/w/$SA '{"email":"a2@sub.dev"}') $(jpost $B/w/$SA '{"email":"bad"}')"

hr "password + session storage"
q $D "select id,email,substr(password_hash,1,60)||'...' h, length(password_hash) len from users"
echo "cookie A: $(grep wl_session $JA | awk '{print substr($7,1,12)"... len="length($7)}')"
q $D "select substr(token_hash,1,16)||'...' token_hash, length(token_hash) len, user_id, expires_at from sessions"
TOK=$(grep wl_session $JA | awk '{print $7}'); echo "raw cookie value present in sessions table? $(q $D "select count(*) n from sessions where token_hash='$TOK'")"

hr "CSRF checks"
echo "edit Origin evil -> $(code -b $JA -H 'Origin: https://evil.example' $B/lists/$SA/edit -d 'title=x')"
echo "edit Origin null -> $(code -b $JA -H 'Origin: null' $B/lists/$SA/edit -d 'title=x')"
echo "edit Referer evil -> $(code -b $JA -H 'Referer: https://evil.example/p' $B/lists/$SA/edit -d 'title=x')"
echo "edit same Origin -> $(code -b $JA -H "Origin: $B" $B/lists/$SA/edit -d 'title=Liste A v2')"
echo "login CSRF Origin evil -> $(code -H 'Origin: https://evil.example' $B/login -d 'email=a@test.dev&password=password')"
echo "public signup Origin evil (allowed by design) -> $(code -H 'Origin: https://evil.example' -H 'Accept: application/json' $B/w/$SA -d 'email=x1@sub.dev')"
echo "Host spoof + matching Origin -> $(code -b $JA -H 'Host: evil.example' -H 'Origin: https://evil.example' $B/lists/$SA/edit -d 'title=Liste A v2')"
echo "Host header reflected in dashboard public link: $(curl -s -b $JA -H 'Host: evil.example' $B/lists/$SA | grep -o 'value="http[^"]*"' | head -1)"

hr "open redirect on login next"
while IFS= read -r n; do
  echo "next=$n -> $(curl -s -D - -o NUL $B/login --data-urlencode "email=a@test.dev" --data-urlencode "password=password" --data-urlencode "next=$n" | tr -d '\r' | grep -i '^location')"
done <<LIST
//evil.example
/\\evil.example
https://evil.example
/lists
/%2F%2Fevil.example
/%5Cevil.example
/lists?x=//evil.example
/@evil.example
LIST
echo "GET /login?next=//evil.example hidden field count: $(curl -s "$B/login?next=//evil.example" | grep -c 'name="next"')"

hr "malformed cookie"
echo "bad session cookie -> $(code -H 'Cookie: wl_session=%E0%A4%A' $B/lists)  unrelated bad cookie + valid session -> $(code -H "Cookie: foo=%zz; wl_session=$TOK" $B/lists)  public page w/ bad cookie -> $(code -H 'Cookie: foo=%zz' $B/w/$SA)"

hr "logout"
echo "sessions for A before logout: $(q $D "select count(*) n from sessions where user_id=1")"
echo "logout -> $(sl -b $JA -X POST $B/logout)"
echo "old cookie after logout -> $(sl -H "Cookie: wl_session=$TOK" $B/lists)"
echo "sessions for A after logout (other logins from the redirect tests remain): $(q $D "select count(*) n from sessions where user_id=1")"

hr "login timing: existing vs unknown email"
for e in a@test.dev nobody@test.dev a@test.dev nobody@test.dev; do curl -s -o NUL -w "$e %{http_code} %{time_total}s\n" $B/login -d "email=$e&password=wrongwrong"; done
echo "msg wrong pw:   $(curl -s $B/login -d 'email=a@test.dev&password=wrongwrong' | grep -o 'class="alert error"[^<]*')"
echo "msg unknown:    $(curl -s $B/login -d 'email=nobody@test.dev&password=wrongwrong' | grep -o 'class="alert error"[^<]*')"

hr "brute force (already counted: 1 weak pw + 1 dup signup + 6 failed logins = 8)"
for i in $(seq 1 6); do echo -n "$(code $B/login -d "email=b@test.dev&password=nope$i") "; done; echo
echo "correct password for B while IP blocked -> $(code $B/login -d 'email=b@test.dev&password=passwordB1')"
echo "signup of a new account while blocked -> $(code $B/signup -d 'email=new@test.dev&password=password12')"

hr "restart -> persistence + session survives"
stop_server; start_server 1 $P $D
echo "B session after restart -> $(code -b $JB $B/lists/$SB)  total $(curl -s -b $JB $B/lists/$SB | grep -o 'stat-value">[0-9]*' | head -1)"
echo "limiter reset by restart: correct login B -> $(code $B/login -d 'email=b@test.dev&password=passwordB1')"
echo "mass signup, 12 accounts, no throttle: $(for i in $(seq 1 12); do code $B/signup -d "email=mass$i@test.dev&password=password12"; echo -n ' '; done)"
echo "B deletes own list -> $(sl -b $JB -X POST $B/lists/$SB/delete) ; public page -> $(code $B/w/$SB) ; subscribers left for it: $(q $D "select count(*) n from subscribers s join lists l on l.id=s.list_id where l.slug='$SB'")"
stop_server; trap - EXIT
sleep 0.5; netstat -ano | grep LISTENING | grep ":$P " || echo "port $P free"
