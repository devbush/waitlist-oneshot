# shared helpers for the audit
export MSYS_NO_PATHCONV=1
A=<racine>/_harness/audit/run-2
AW=<racine>/_harness/audit/run-2
SRV_PID=""
# start_server <step> <port> <datadir-name> [extra env assignments...]
start_server() {
  local step=$1 port=$2 data=$3; shift 3
  mkdir -p "$A/data/$data"
  ( cd "$A/step-$step" && exec env PORT=$port DB_PATH="$AW/data/$data/waitlist.db" "$@" node --disable-warning=ExperimentalWarning server.js ) >>"$A/data/$data/server-$port.log" 2>&1 &
  SRV_PID=$!
  for i in $(seq 1 50); do
    curl -s -o NUL "http://127.0.0.1:$port/" && return 0
    sleep 0.2
  done
  echo "SERVER FAILED TO START"; cat "$A/data/$data/server-$port.log"; return 1
}
stop_server() {
  [ -n "$SRV_PID" ] && kill "$SRV_PID" 2>/dev/null; wait "$SRV_PID" 2>/dev/null; SRV_PID=""
}
hr() { echo; echo "### $*"; }
q() { node --disable-warning=ExperimentalWarning "$AW/scripts/q.mjs" "$AW/data/$1/waitlist.db" "$2" "$3"; }
code() { curl -s -o NUL -w '%{http_code}' "$@"; }
# status + location + set-cookie on one line
sl() { curl -s -D - -o NUL "$@" | tr -d '\r' | grep -iE '^HTTP|^location|^set-cookie' | tr '\n' ' '; echo; }
JH='Content-Type: application/json'
JA_='Accept: application/json'
# jpost <url> <json> [extra curl args]
jpost() { local u=$1 b=$2; shift 2; curl -s -w ' [%{http_code}]' -H "$JH" -H "$JA_" "$@" -d "$b" "$u"; }
SRV_ARGS=()
NREQ=0
start() { SRV_ARGS=("$@"); NREQ=0; start_server "$@"; }
restart() { stop_server; NREQ=0; start_server "${SRV_ARGS[@]}"; }
# pub <port> <slug> <email> [json extra fields]: public signup; rotates loopback address and restarts the server to stay under the 8/min/IP limiter
pub() {
  local port=$1 slug=$2 email=$3 extra=$4 host
  if [ "$NREQ" -ge 16 ]; then restart; fi
  if [ "$NREQ" -lt 8 ]; then host=127.0.0.1; else host='[::1]'; fi
  NREQ=$((NREQ+1))
  curl -s -w ' [%{http_code}]' -H "$JH" -H "$JA_" -d "{\"email\":\"$email\"$extra}" "http://$host:$port/w/$slug"
}
bulk() { local port=$1 slug=$2 prefix=$3 from=$4 to=$5 i; for i in $(seq $from $to); do pub $port $slug "$prefix$i@sub.dev" >/dev/null; done; }
