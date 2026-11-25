#!/usr/bin/env bash
set -u
N=$1
ROOT=${ROOT:-$PWD}
H=$ROOT/_harness
APP=$ROOT/run-$N
mkdir -p "$APP" "$H/run-$N/logs" "$H/run-$N/snap"
SID=$(node -e "console.log(require('crypto').randomUUID())")
echo "$SID" > "$H/run-$N/session-id"
export PORT=$((3100+N))
cd "$APP"
for K in 0 1 2 3 4; do
  if [ "$K" = 0 ]; then S=(--session-id "$SID"); else S=(--resume "$SID"); fi
  timeout 45m claude -p "$(cat "$H/prompts/$K.txt")" --model claude-opus-5-5 --effort medium --safe-mode --dangerously-skip-permissions --output-format json "${S[@]}" < /dev/null > "$H/run-$N/logs/step-$K.json" 2> "$H/run-$N/logs/step-$K.err"
  echo "run $N step $K exit $? $(date +%H:%M)" >> "$H/run-$N/progress.log"
  mkdir -p "$H/run-$N/snap/step-$K"
  tar --exclude=node_modules --exclude=.next --exclude=dist --exclude=build --exclude=.git -cf - . | tar -xf - -C "$H/run-$N/snap/step-$K"
done
echo "run $N done $(date +%H:%M)" >> "$H/run-$N/progress.log"
