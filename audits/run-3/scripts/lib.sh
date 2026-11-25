AUD=<racine>/_harness/audit/run-3
start() {
  local step=$1 port=$2 dname=$3; shift 3
  mkdir -p "$AUD/data/$dname"
  ( cd "$AUD/step-$step" && exec env PORT=$port DB_PATH="$AUD/data/$dname/waitlist.db" "$@" node --no-warnings=ExperimentalWarning server.js >"$AUD/logs/server-$step-$port.log" 2>&1 ) &
  SRV_PID=$!
  B=http://127.0.0.1:$port
  curl -s -o /dev/null --retry 15 --retry-connrefused --retry-delay 1 "$B/" || echo "SERVER DID NOT START"
}
stop() { kill $SRV_PID 2>/dev/null; wait $SRV_PID 2>/dev/null; }
# req METHOD PATH [json|''] [extra curl args...]
req() {
  local m=$1 p=$2 d=${3-}; shift; shift; [ $# -gt 0 ] && shift
  echo ">>> $m $p ${d:+body=$d} $*"
  if [ -n "$d" ]; then curl -s -X "$m" "$B$p" -H 'Content-Type: application/json' --data-binary "$d" -w '\n<<< HTTP %{http_code}\n' "$@"
  else curl -s -X "$m" "$B$p" -w '\n<<< HTTP %{http_code}\n' "$@"; fi
}
jget() { node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const o=JSON.parse(s);console.log(process.argv[1].split(".").reduce((a,k)=>a?.[k],o)??"")}catch{console.log("")}})' "$1"; }
# sql <dname> <query>  (read-only inspection of the audit copy of the DB)
sql() { node --no-warnings -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1]);console.log(JSON.stringify(d.prepare(process.argv[2]).all(),null,0));d.close()' "$AUD/data/$1/waitlist.db" "$2"; }
