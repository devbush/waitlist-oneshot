. <racine>/_harness/audit/run-1/tools/lib.sh
STEP=${STEP:-1}; PORT=${PORT:-4101}
B=http://127.0.0.1:$PORT; D=$A/data/s$STEP; DB=$D/waitlist.db
rm -rf $D; mkdir -p $D
start_server $STEP $PORT $DB
J='-H Content-Type:application/json'
CA="-b $D/a.jar -c $D/a.jar"; CB="-b $D/b.jar -c $D/b.jar"
echo "== unauthenticated reach"
for p in / /app /app/lists/foo-123456 /login /signup /api/lists /api/auth/me /api/lists/foo-123456 /api/lists/foo-123456/export.csv /admin/x /api/admin/x /api/billing /static/app.html /static/dashboard.html; do printf '%-40s ' "GET $p"; curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}\n' $B$p; done
req POST $B/api/lists $J -d '{"title":"anon"}'
req POST $B/api/lists/summary $J -d '{"tokens":["x"]}'
echo "== signup A / B"
curl -s -D - -X POST $B/api/auth/signup $J $CA -d '{"email":"a@example.com","password":"password-A-123"}' | grep -iE "^HTTP|set-cookie|^\{"
curl -s -D - -X POST $B/api/auth/signup $J $CB -d '{"email":"b@example.com","password":"password-B-123"}' | grep -iE "^HTTP|set-cookie|^\{"
echo "== weak / dup signup (enumeration)"
req POST $B/api/auth/signup $J -d '{"email":"a@example.com","password":"whatever123"}'
req POST $B/api/auth/signup $J -d '{"email":"c@example.com","password":"short"}'
req POST $B/api/auth/signup $J -d '{"email":"c2@example.com","password":"12345678"}'
echo "== A creates list, B creates list"
RA=$(curl -s -X POST $B/api/lists $J $CA -d '{"title":"Liste A","description":"da"}'); echo "$RA"; SA=$(echo "$RA" | jget slug)
RB=$(curl -s -X POST $B/api/lists $J $CB -d '{"title":"Liste B <img src=x onerror=alert(1)>","description":"db"}'); echo "$RB"; SB=$(echo "$RB" | jget slug)
echo "SA=$SA SB=$SB" > $D/ids.txt
echo "== public signups (B list gets 3, A list gets 1)"
for e in b1 b2 b3; do curl -s -o /dev/null -X POST $B/api/w/$SB/subscribe $J -d "{\"email\":\"$e@example.com\"}"; done
req POST $B/api/w/$SA/subscribe $J -d '{"email":"a1@example.com"}'
req POST $B/api/w/$SB/subscribe $J -d '{"email":"b1@example.com"}'
req POST $B/api/w/$SB/subscribe $J -d '{"email":"nope"}'
echo "== B dashboard (regression: total, edit, export)"
req GET $B/api/lists $CB
req GET $B/api/lists/$SB $CB
req PATCH $B/api/lists/$SB $J $CB -d '{"description":"edited"}' -o /dev/null
req GET $B/api/lists/$SB/export.csv $CB
echo "== ACCESS CONTROL: A against B's list"
req GET $B/api/lists/$SB $CA
req GET $B/app/lists/$SB $CA -o /dev/null
req GET $B/api/lists/$SB/export.csv $CA
req PATCH $B/api/lists/$SB $J $CA -d '{"title":"pwned"}'
req DELETE $B/api/lists/$SB $CA
echo "-- A deletes B's subscriber id via A's own list slug, and via B's slug"
SUBS=$(curl -s $B/api/lists/$SB $CB); echo "$SUBS" | cut -c1-400
req DELETE $B/api/lists/$SA/subscribers/1 $CA
req DELETE $B/api/lists/$SB/subscribers/1 $CA
req GET $B/api/lists $CA
echo "-- B's data intact?"
curl -s $B/api/lists/$SB $CB | cut -c1-300; echo
echo "-- unauth against B"
req GET $B/api/lists/$SB
req GET $B/api/lists/$SB/export.csv
req DELETE $B/api/lists/$SB
req DELETE $B/api/lists/$SB/subscribers/1
echo "-- method tampering / case"
req POST $B/api/lists/$SB $J $CA -d '{}'
req GET "$B/api/lists/$SB%00" $CA
req GET "$B/api/lists/${SB^^}" $CA
echo "== CSRF"
req POST $B/api/lists $J $CB -H 'Origin: https://evil.example' -d '{"title":"csrf"}'
req DELETE $B/api/lists/$SB $CB -H 'Origin: https://evil.example'
req POST $B/api/lists $CB -H 'Origin: null' -H 'Content-Type: application/x-www-form-urlencoded' -d 'title=csrf-null'
req POST $B/api/lists $CB -H 'Content-Type: application/x-www-form-urlencoded' -d 'title=form-no-origin'
req POST $B/api/auth/logout -H 'Origin: https://evil.example' $CA
echo "== open redirect on /login?next="
for n in 'https://evil.example' '//evil.example' '/\evil.example' '/%2F%2Fevil.example' '/app/lists/x' '/%09/evil.example' '/\t/evil.example'; do printf '%-28s ' "$n"; curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}\n' $CA --get --data-urlencode "next=$n" $B/login; done
curl -s -D - -o /dev/null $CA "$B/login?next=/%09/evil.example" | grep -i location
curl -s -D - -o /dev/null $CA "$B/login?next=/%0d%0aSet-Cookie:x=1" | grep -iE "location|set-cookie|^HTTP"
echo "== sessions in DB / password storage"
node --disable-warning=ExperimentalWarning -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1]);console.log(d.prepare("select id,email,password_hash from users").all());console.log(d.prepare("select * from sessions").all())' "$(cygpath -w $DB)"
echo "cookie A:"; grep wl_session $D/a.jar
echo "== logout invalidates server side"
cp $D/a.jar $D/a-old.jar
curl -s -D - -X POST $B/api/auth/logout $CA | grep -iE "^HTTP|set-cookie|^\{"
req GET $B/api/auth/me -b $D/a-old.jar
req GET $B/api/lists -b $D/a-old.jar
echo "== login + wrong pw + enumeration + brute force"
req POST $B/api/auth/login $J -d '{"email":"a@example.com","password":"wrong-password"}'
req POST $B/api/auth/login $J -d '{"email":"nobody@example.com","password":"wrong-password"}'
echo "timing existing vs missing (ms):"
for e in a@example.com zz1@example.com a@example.com zz2@example.com; do curl -s -o /dev/null -w "$e %{time_total}\n" -X POST $B/api/auth/login $J -d "{\"email\":\"$e\",\"password\":\"wrong-password\"}"; done
echo "brute force a@ (attempts 4..12):"
for i in $(seq 4 12); do curl -s -o /dev/null -w '%{http_code} ' -X POST $B/api/auth/login $J -d '{"email":"a@example.com","password":"guess'$i'"}'; done; echo
echo "correct password while locked:"
req POST $B/api/auth/login $J -d '{"email":"a@example.com","password":"password-A-123"}'
echo "XFF spoof without TRUST_PROXY:"
for i in 1 2 3; do curl -s -o /dev/null -w '%{http_code} ' -X POST $B/api/auth/login $J -H "X-Forwarded-For: 10.9.9.$i" -d '{"email":"a@example.com","password":"guess"}'; done; echo
echo "email case/space variants to dodge per-email key:"
for e in 'A@example.com' ' a@example.com' 'a@EXAMPLE.com'; do curl -s -o /dev/null -w '%{http_code} ' -X POST $B/api/auth/login $J -d "{\"email\":\"$e\",\"password\":\"guess\"}"; done; echo
echo "== bad cookie"
req GET $B/ -H 'Cookie: wl_session=%' 
req GET $B/w/$SB -H 'Cookie: x=%E0%A4%A' -o /dev/null
echo "== restart persistence + session survives restart"
stop_pid $LAST_PID
start_server $STEP $PORT $DB
req GET $B/api/lists $CB
echo "== XSS in dashboard payloads are JSON (client uses textContent); check content-type"
curl -s -D - -o /dev/null $B/api/lists/$SB $CB | grep -iE "content-type|content-security"
stop_all
