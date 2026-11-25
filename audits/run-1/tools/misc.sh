. <racine>/_harness/audit/run-1/tools/lib.sh
echo "== preload check: listen(0) remapped?"
NODE_OPTIONS="--import file:///$(cygpath -m $A/tools/port-preload.mjs)" node -e 'const s=require("http").createServer();s.listen(0,()=>{console.log("listen(0) bound to",s.address().port);s.close()})'
PORT=4104; B=http://127.0.0.1:$PORT; D=$A/data/s4-misc; rm -rf $D; mkdir -p $D
J='-H Content-Type:application/json'; CA="-b $D/a.jar -c $D/a.jar"
start_server 4 $PORT $D/waitlist.db
curl -s -o /dev/null -X POST $B/api/auth/signup $J $CA -d '{"email":"a@example.com","password":"password-A-123"}'
L=$(curl -s -X POST $B/api/lists $J $CA -d '{"title":"Misc"}' | jget slug)
for i in 1 2 3 4 5 6 7; do curl -s -o /dev/null -X POST $B/api/w/$L/subscribe $J -d "{\"email\":\"m$i@example.com\"}"; done
C7=$(curl -s -X POST $B/api/w/$L/subscribe $J -d '{"email":"m7@example.com"}' | jget refCode)
curl -s -X POST $B/api/w/$L/subscribe $J -d "{\"email\":\"ref1@example.com\",\"ref\":\"$C7\"}" | cut -c1-80; echo
echo -n "m7 after 1 referral: "; curl -s $B/api/w/$L/status/$C7; echo
RID=$(curl -s $B/api/lists/$L $CA | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);const r=o.subscribers.find(x=>x.email=="ref1@example.com");console.log(r.id);console.error("owner sees referredBy =",r.referredBy)})')
req DELETE $B/api/lists/$L/subscribers/$RID $CA
echo -n "m7 after owner deleted the referee: "; curl -s $B/api/w/$L/status/$C7; echo
echo "== body limit (20 KB JSON)"
node -e 'process.stdout.write(JSON.stringify({title:"x".repeat(20000)}))' > $D/big.json
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/api/lists $J $CA --data-binary @$D/big.json
echo "== long password (201 chars) / title clamp"
curl -s -X POST $B/api/auth/signup $J -d "{\"email\":\"long@example.com\",\"password\":\"$(printf 'a%.0s' $(seq 1 201))\"}"; echo
curl -s -X POST $B/api/lists $J $CA -d "{\"title\":\"$(printf 'T%.0s' $(seq 1 120))\"}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log("title length stored:",JSON.parse(s).title.length))'
echo "== signup rate limit (12 accounts from one IP)"
for i in $(seq 1 12); do curl -s -o /dev/null -w '%{http_code} ' -X POST $B/api/auth/signup $J -d "{\"email\":\"bulk$i@example.com\",\"password\":\"password-123\"}"; done; echo
echo "== static dir reachable files"
for f in app.html dashboard.html auth.html home.html common.js server.js ../package.json ..%2Fdata%2Fwaitlist.db; do printf '%-28s %s\n' "/static/$f" "$(curl -s -o /dev/null -w '%{http_code}' --path-as-is $B/static/$f)"; done
for p in /data/waitlist.db /server.js /package.json /.git/config /.env /README.md; do printf '%-28s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' $B$p)"; done
echo "== perf: public signup cost on a 5,000-subscriber list (ranking recomputed on every call)"
node --disable-warning=ExperimentalWarning -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1]);const id=d.prepare("select id from lists limit 1").get().id;const ins=d.prepare("insert into subscribers(list_id,email,created_at,ref_code) values(?,?,?,?)");d.exec("begin");for(let i=0;i<5000;i++)ins.run(id,"bulk"+i+"@x.co",Date.now(),"zz"+String(i).padStart(6,"0"));d.exec("commit");console.log("inserted 5000 rows directly in the audit DB copy")' "$(cygpath -m $D/waitlist.db)"
curl -s -o /dev/null -w 'subscribe on 5k list: %{time_total}s\n' -X POST $B/api/w/$L/subscribe $J -d '{"email":"perf@example.com"}'
curl -s -o /dev/null -w 'status   on 5k list: %{time_total}s\n' $B/api/w/$L/status/$C7
curl -s -o /dev/null -w 'GET page on 5k list: %{time_total}s\n' $B/w/$L
stop_all
