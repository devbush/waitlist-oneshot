. <racine>/_harness/audit/run-1/tools/lib.sh
PORT=4101; B=http://127.0.0.1:$PORT; D=$A/data/up0to1; DB=$D/waitlist.db
rm -rf $D; cp -r $A/data/s0 $D
. $D/ids.txt; echo "step-0 list: slug=$SLUG token=$TOK"
J='-H Content-Type:application/json'
dump() { node --disable-warning=ExperimentalWarning -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1]);for(const t of ["lists","subscribers","users"]){try{console.log(t,JSON.stringify(d.prepare("select * from "+t+" limit 4").all()))}catch(e){console.log(t,"ERR",e.message)}}' "$(cygpath -w $DB)"; }
echo "== DB before upgrade"; dump
start_server 1 $PORT $DB
echo "== DB after step-1 start"; dump
echo "== old public page still up?"
curl -s -o /dev/null -w 'GET /w/SLUG -> %{http_code}\n' $B/w/$SLUG
req POST $B/api/w/$SLUG/subscribe $J -d '{"email":"after-upgrade@example.com"}'
echo "== old step-0 access paths"
req GET $B/admin/$TOK -o /dev/null
req GET $B/api/admin/$TOK
req GET $B/api/admin/$TOK/export.csv
req POST $B/api/lists/summary $J -d "{\"tokens\":[\"$TOK\"]}"
echo "== new account: can it see / claim the old list?"
curl -s -o /dev/null -X POST $B/api/auth/signup $J -c $D/o.jar -d '{"email":"owner@example.com","password":"password-owner-1"}'
req GET $B/api/lists -b $D/o.jar
req GET $B/api/lists/$SLUG -b $D/o.jar
req GET $B/api/lists/$SLUG/export.csv -b $D/o.jar
req PATCH $B/api/lists/$SLUG $J -b $D/o.jar -d '{"title":"claim"}'
stop_all
echo "== DB final"; dump
