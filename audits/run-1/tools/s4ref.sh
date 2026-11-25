. <racine>/_harness/audit/run-1/tools/lib.sh
STEP=4; PORT=4104
B=http://127.0.0.1:$PORT; D=$A/data/s4-ref; DB=$D/waitlist.db
rm -rf $D; mkdir -p $D
J='-H Content-Type:application/json'
CA="-b $D/a.jar -c $D/a.jar"; CB="-b $D/b.jar -c $D/b.jar"
start_server $STEP $PORT $DB TRUST_PROXY=1
curl -s -o /dev/null -X POST $B/api/auth/signup $J $CA -H 'X-Forwarded-For: 10.0.0.1' -d '{"email":"a@example.com","password":"password-A-123"}'
curl -s -o /dev/null -X POST $B/api/auth/signup $J $CB -H 'X-Forwarded-For: 10.0.0.2' -d '{"email":"b@example.com","password":"password-B-123"}'
L=$(curl -s -X POST $B/api/lists $J $CA -d '{"title":"Ref \"list\" <b>","description":"d"}' | jget slug)
L2=$(curl -s -X POST $B/api/lists $J $CB -d '{"title":"Other"}' | jget slug)
subj() { curl -s -X POST $B/api/w/$1/subscribe $J -H "X-Forwarded-For: 10.7.$((RANDOM%250)).$((RANDOM%250))" -d "$2"; }
for i in $(seq 1 11); do subj $L "{\"email\":\"e$i@example.com\"}" >/dev/null; done
echo "== attacker signs up last (12th)"
R=$(subj $L '{"email":"attacker@example.com"}'); echo "$R"; CODE=$(echo "$R" | jget refCode)
echo "== one real referral: +5"
subj $L "{\"email\":\"friend@example.com\",\"ref\":\"$CODE\"}"; echo
req GET $B/api/w/$L/status/$CODE
echo "== REFERRAL ABUSE: attacker refers 3 invented addresses (plus-aliases, no email confirmation)"
for i in 1 2 3; do subj $L "{\"email\":\"attacker+$i@example.com\",\"ref\":\"$CODE\"}" | cut -c1-90; echo; done
req GET $B/api/w/$L/status/$CODE
echo "== duplicate email with ref gives nothing; self-referral by re-submitting own email"
subj $L "{\"email\":\"friend@example.com\",\"ref\":\"$CODE\"}"; echo
subj $L "{\"email\":\"attacker@example.com\",\"ref\":\"$CODE\"}"; echo
echo "== code from another list is ignored"
OC=$(subj $L2 '{"email":"o1@example.com"}' | jget refCode)
subj $L "{\"email\":\"cross@example.com\",\"ref\":\"$OC\"}"; echo
req GET $B/api/w/$L2/status/$OC
req GET $B/api/w/$L/status/$OC
req GET $B/api/w/$L2/status/$CODE
echo "== INFO LEAK: anyone who knows an email learns it is on the list, plus its rank and referral code"
subj $L '{"email":"e3@example.com"}'; echo
subj $L '{"email":"never-seen@example.org","website":"http://bot"}'; echo
echo "== status endpoint brute force limit (65 requests, same IP)"
for i in $(seq 1 65); do curl -s -o /dev/null -w '%{http_code} ' $B/api/w/$L/status/aaaaaaa$((i%10)); done | tr ' ' '\n' | sort | uniq -c | tr '\n' ' '; echo
echo "== XSS probes on ref (GET + form POST error path + form POST success)"
curl -s "$B/w/$L?ref=%22%3E%3Cscript%3Ealert(1)%3C/script%3E" | grep -nE 'name="ref"|data-invited' | cut -c1-200
curl -s "$B/w/$L?ref=$CODE" | grep -nE 'name="ref"|data-invited' | cut -c1-200
curl -s -X POST $B/w/$L -H 'X-Forwarded-For: 10.3.3.3' --data-urlencode 'email=bad' --data-urlencode 'ref="><script>alert(1)</script>' | grep -nE 'name="ref"|name="email"|value="' | cut -c1-220
curl -s -X POST $B/w/$L -H 'X-Forwarded-For: 10.3.3.4' --data-urlencode 'email=formref@example.com' --data-urlencode "ref=$CODE" | grep -nE 'data-share-url|data-position|data-page-url|data-share="x"' | cut -c1-330
echo "== Host header injection into the referral link and CSV"
curl -s -X POST $B/w/$L -H 'Host: evil.example' -H 'X-Forwarded-For: 10.3.3.5' --data-urlencode 'email=hosthdr@example.com' | grep -nE 'data-share-url' | cut -c1-200
curl -s $B/api/lists/$L/export.csv $CA -H 'Host: evil.example' | head -3
echo "== dashboard JSON for owner: rank order + referrer"
curl -s $B/api/lists/$L $CA | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);console.log("total",o.total,"referred",o.referred);for(const x of o.subscribers.sort((a,b)=>a.position-b.position).slice(0,6))console.log(x.position,x.email,"referrals="+x.referrals,"referredBy="+x.referredBy,"id="+x.id)})'
echo "== owner deletes one fake referee -> attacker loses 5 places?"
FID=$(curl -s $B/api/lists/$L $CA | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).subscribers.find(x=>x.email=="attacker+1@example.com").id)})')
req DELETE $B/api/lists/$L/subscribers/$FID $CA
req GET $B/api/w/$L/status/$CODE
echo "== B cannot read A's list in step 4, status needs code"
req GET $B/api/lists/$L $CB
echo "== OPEN REDIRECT (logged-in user A), raw Location header"
for n in '/%09/evil.example' '/%0a/evil.example' '//evil.example' '/%5Cevil.example' 'https://evil.example' '/app/lists/x'; do printf '%-24s ' "$n"; curl -s -D - -o /dev/null $CA "$B/login?next=$n" | grep -i '^location' | cat -A | cut -c1-80; done
node -e 'for (const l of ["/\t/evil.example","/app"]) console.log(JSON.stringify(l), "->", new URL(l, "https://waitlist.example/login").href)'
echo "== security headers on public page + HSTS?"
curl -s -D - -o /dev/null $B/w/$L | grep -viE "^date|^connection|^keep-alive|^transfer"
stop_all
