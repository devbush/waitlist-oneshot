# Helpers for the audit. Servers are started and stopped by PID only.
A=<racine>/_harness/audit/run-1
PIDS=""
start_server() { # step port dbpath [ENV=VAL...]
  local step=$1 port=$2 db=$3; shift 3
  mkdir -p "$(dirname "$db")"
  if netstat -ano | grep -qE "[:.]$port +.*LISTENING"; then echo "PORT $port BUSY, abort"; exit 9; fi
  ( cd $A/step-$step && exec env PORT=$port DB_PATH="$(cygpath -m "$db")" "$@" node --disable-warning=ExperimentalWarning server.js ) >> $A/logs/server-step$step-$port.log 2>&1 &
  local pid=$!
  PIDS="$PIDS $pid"
  LAST_PID=$pid
  for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:$port/ && break; sleep 0.2; done
  echo "[started step-$step on :$port pid=$pid]"
}
stop_pid() { kill $1 2>/dev/null; wait $1 2>/dev/null; PIDS=$(echo " $PIDS " | sed "s/ $1 / /"); echo "[stopped pid=$1]"; }
stop_all() { for p in $PIDS; do kill $p 2>/dev/null; wait $p 2>/dev/null; echo "[stopped pid=$p]"; done; PIDS=""; }
trap stop_all EXIT
# req METHOD URL [curl args...] -> prints "HTTP <code>" + body (truncated)
req() { local m=$1 u=$2; shift 2; echo ">>> $m $u $*" | cut -c1-300; curl -s -X $m "$u" -w '\n<<< HTTP %{http_code}\n' "$@" | cut -c1-${TRUNC:-600}; }
jget() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{let o=JSON.parse(s);for(const k of process.argv[1].split("."))o=o?.[k];console.log(o??"")}catch{console.log("")}})' "$1"; }
