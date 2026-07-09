#!/bin/bash
# MarkEye Ubuntu 产线 kiosk 启动脚本（阶段 1 验证用，一体启动后端+浏览器）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"
ROOT="$(markeye_deploy_root)"

cd "$ROOT"

if markeye_systemd_web_active; then
  echo "[信息] markeye-web.service 已在运行，仅启动浏览器（避免双实例）"
  exec "$SCRIPT_DIR/kiosk-browser.sh"
fi

markeye_ensure_venv "$ROOT" 0

python -m src.web_server &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT

markeye_wait_for_health "http://127.0.0.1:8080/api/health" 60

export DISPLAY="${DISPLAY:-:0}"
CHROMIUM="$(markeye_find_chromium)" || {
  echo "[错误] 未找到 Chromium/Chrome，请安装: sudo apt install chromium-browser"
  exit 1
}

if command -v unclutter >/dev/null 2>&1; then
  unclutter -idle 0 -root &
fi

# shellcheck disable=SC2046
"$CHROMIUM" $(markeye_chromium_kiosk_flags "http://127.0.0.1:8080/template/") &
UI_PID=$!

trap "kill $SERVER_PID $UI_PID 2>/dev/null || true" EXIT
wait $SERVER_PID
