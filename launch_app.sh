#!/bin/bash
PROJECT_DIR="/Users/threedwizard/Desktop/AI Agent/Digital Agency/AI Editor/reel_pipeline"
PORT=5050
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
USER_DATA_DIR="$HOME/Library/Application Support/ReelPipelineApp"
PID_FILE="/tmp/reel_pipeline.pid"

export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

cd "$PROJECT_DIR" || exit 1

cleanup() {
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE" 2>/dev/null)
    if [ -n "$PID" ]; then
      kill "$PID" 2>/dev/null
    fi
    rm -f "$PID_FILE"
  fi
  lsof -ti:"$PORT" | xargs kill -9 2>/dev/null
  pkill -f "ReelPipelineApp" 2>/dev/null || true
  exit 0
}

trap cleanup EXIT INT TERM HUP

# 1. Start Python Flask server if not already responding
if ! curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT" 2>/dev/null | grep -q "200"; then
  lsof -ti:"$PORT" | xargs kill -9 2>/dev/null
  nohup python3 app.py > /tmp/reel_pipeline.log 2>&1 &
  echo $! > "$PID_FILE"

  # Wait for server to be ready
  for i in {1..40}; do
    if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT" 2>/dev/null | grep -q "200"; then
      break
    fi
    sleep 0.3
  done
fi

# 2. Launch dedicated standalone app window (same as Swift Feed)
mkdir -p "$USER_DATA_DIR"

if [ -f "$CHROME" ]; then
  "$CHROME" \
    --app="http://127.0.0.1:$PORT" \
    --user-data-dir="$USER_DATA_DIR" \
    --window-size=1400,920 \
    --no-first-run \
    --no-default-browser-check &
  CHROME_PID=$!
else
  open "http://127.0.0.1:$PORT"
  CHROME_PID=""
fi

# 3. Watchdog loop: keep server running while window is open; clean up on close
while true; do
  if [ -n "$CHROME_PID" ] && ! kill -0 "$CHROME_PID" 2>/dev/null; then
    break
  fi
  if ! curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT" 2>/dev/null | grep -q "200"; then
    break
  fi
  sleep 1.5
done

cleanup
