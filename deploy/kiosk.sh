#!/bin/bash
# MarkEye Ubuntu 产线 kiosk 启动脚本
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -q -r requirements.txt

python -m src.web_server &
SERVER_PID=$!
sleep 2

export DISPLAY="${DISPLAY:-:0}"
CHROMIUM=""
for candidate in chromium-browser chromium google-chrome; do
  if command -v "$candidate" >/dev/null 2>&1; then
    CHROMIUM="$candidate"
    break
  fi
done
if [ -z "$CHROMIUM" ]; then
  echo "[错误] 未找到 Chromium/Chrome，请安装: sudo apt install chromium-browser"
  kill "$SERVER_PID" 2>/dev/null || true
  exit 1
fi
"$CHROMIUM" --kiosk --app=http://127.0.0.1:8080/template/ &
UI_PID=$!

trap "kill $SERVER_PID $UI_PID 2>/dev/null || true" EXIT
wait $SERVER_PID
