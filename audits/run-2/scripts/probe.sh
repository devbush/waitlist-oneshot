. "$(dirname "$0")/lib.sh"
P=4202; D=probe; rm -rf "$A/data/$D"
trap stop_server EXIT
start_server 2 $P $D || exit 1
J="$AW/data/$D/a.jar"
sl -c $J http://127.0.0.1:$P/signup -d 'email=a@test.dev&password=passwordA1' >/dev/null
S=$(sl -b $J http://127.0.0.1:$P/lists -d 'title=probe' | grep -o '/lists/[a-z0-9-]*' | cut -d/ -f3)
for i in $(seq 1 10); do echo -n "$(code -H "$JA_" http://127.0.0.1:$P/w/$S -d "email=p$i@x.co") "; done; echo " <- via 127.0.0.1"
for i in $(seq 11 13); do echo -n "$(code -H "$JA_" http://127.0.0.2:$P/w/$S -d "email=p$i@x.co") "; done; echo " <- via 127.0.0.2"
echo -n "$(code -H "$JA_" "http://[::1]:$P/w/$S" -d "email=p14@x.co") <- via ::1"; echo
stop_server; trap - EXIT; sleep 0.3; netstat -ano | grep LISTENING | grep ":$P " || echo "port $P free"
