. <racine>/_harness/audit/run-1/tools/lib.sh
J='-H Content-Type:application/json'
dump() { node --disable-warning=ExperimentalWarning -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1]);for(const t of ["lists","subscribers","users"]){try{const n=d.prepare("select count(*) n from "+t).get().n;const cols=d.prepare("select name from pragma_table_info(\""+t+"\")").all().map(c=>c.name).join(",");console.log(" ",t,"rows="+n,"cols="+cols)}catch(e){console.log(" ",t,"ERR",e.message)}};try{console.log("  subs without ref_code:",d.prepare("select count(*) n from subscribers where ref_code is null").get().n)}catch{}' "$(cygpath -m $1)"; }

echo "################ step-1 data -> step-2"
D=$A/data/up1to2; rm -rf $D; cp -r $A/data/s1 $D; . $D/ids.txt; B=http://127.0.0.1:4102
dump $D/waitlist.db
start_server 2 4102 $D/waitlist.db
dump $D/waitlist.db
echo "-- B's old session cookie still valid, lists + subscribers intact:"
curl -s $B/api/lists -b $D/b.jar | cut -c1-420; echo
curl -s $B/api/lists/$SB -b $D/b.jar | cut -c1-330; echo
echo "-- old password still logs in (hash format unchanged):"
req POST $B/api/auth/login $J -d '{"email":"b@example.com","password":"password-B-123"}'
echo "-- public signup + export on old list:"
req POST $B/api/w/$SB/subscribe $J -d '{"email":"post-upgrade@example.com"}'
curl -s $B/api/lists/$SB/export.csv -b $D/b.jar | tail -2
echo "-- A (other account) still locked out of B's list:"
req POST $B/api/auth/login $J -c $D/a2.jar -H 'X-Forwarded-For: 1.1.1.1' -d '{"email":"c2@example.com","password":"12345678"}'
req GET $B/api/lists/$SB -b $D/a2.jar
stop_all

echo "################ step-2 data (free account with 130 subs, 30 hidden) -> step-4"
D=$A/data/up2to4; rm -rf $D; cp -r $A/data/s2-limit $D; B=http://127.0.0.1:4104
dump $D/waitlist.db
start_server 4 4104 $D/waitlist.db
dump $D/waitlist.db
curl -s $B/api/lists -b $D/a.jar > $D/lists.json; cut -c1-330 $D/lists.json; echo
S=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).lists[0].slug)' $(cygpath -m $D/lists.json))
curl -s $B/api/lists/$S -b $D/a.jar | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);console.log(JSON.stringify({total:o.total,hidden:o.hidden,visible:o.subscribers.length,sample:o.subscribers.slice(-2)}))})'
echo "-- old subscriber gets a working referral link after upgrade:"
RC=$(curl -s $B/api/lists/$S -b $D/a.jar | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);console.log(o.subscribers.slice(-1)[0].refCode)})')
req GET $B/api/w/$S/status/$RC
req POST $B/api/w/$S/subscribe $J -d "{\"email\":\"new-after-upgrade@example.com\",\"ref\":\"$RC\"}"
req GET $B/api/w/$S/status/$RC
echo "-- owner deletes the referee -> referrer loses the boost (referee is hidden on free plan -> cannot delete?)"
curl -s $B/api/lists/$S/export.csv -b $D/a.jar | head -3
stop_all

echo "################ chain: step-0 data -> step-1 (done) -> step-2 -> step-4, and step-0 -> step-4 direct"
D=$A/data/up-chain; rm -rf $D; cp -r $A/data/up0to1 $D; . $A/data/s0/ids.txt; B=http://127.0.0.1:4102
start_server 2 4102 $D/waitlist.db; stop_pid $LAST_PID
B=http://127.0.0.1:4104; start_server 4 4104 $D/waitlist.db
dump $D/waitlist.db
curl -s -o /dev/null -w "public page of step-0 list: %{http_code}\n" $B/w/$SLUG
req POST $B/api/w/$SLUG/subscribe $J -d '{"email":"chain@example.com"}'
req GET $B/admin/$TOK -o /dev/null
req GET $B/api/admin/$TOK
req POST $B/api/auth/login $J -c $D/o2.jar -d '{"email":"owner@example.com","password":"password-owner-1"}'
req GET $B/api/lists -b $D/o2.jar
req GET $B/api/lists/$SLUG -b $D/o2.jar
stop_all
D=$A/data/up0to4; rm -rf $D; cp -r $A/data/s0 $D
start_server 4 4104 $D/waitlist.db
dump $D/waitlist.db
curl -s -o /dev/null -w "direct 0->4 public page: %{http_code}\n" $B/w/$SLUG
req GET $B/api/admin/$TOK
node --disable-warning=ExperimentalWarning -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1]);console.log("orphan lists:",JSON.stringify(d.prepare("select id,user_id,slug,(select count(*) from subscribers s where s.list_id=l.id) subs from lists l").all()))' "$(cygpath -m $D/waitlist.db)"
stop_all
