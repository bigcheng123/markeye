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
chromium-browser --kiosk --app=http://127.0.0.1:8080/template/ &
UI_PID=$!

trap "kill $SERVER_PID $UI_PID 2>/dev/null || true" EXIT
wait $SERVER_PID
