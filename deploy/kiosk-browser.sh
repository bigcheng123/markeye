#!/bin/bash
# MarkEye Chromium kiosk 浏览器启动（供 XDG autostart / openbox 使用）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

APP_URL="${MARKEYE_APP_URL:-http://127.0.0.1:8080/template/}"
HEALTH_URL="${MARKEYE_HEALTH_URL:-http://127.0.0.1:8080/api/health}"
HEALTH_TIMEOUT="${MARKEYE_HEALTH_TIMEOUT:-90}"

export DISPLAY="${DISPLAY:-:0}"

markeye_wait_for_health "$HEALTH_URL" "$HEALTH_TIMEOUT"

CHROMIUM="$(markeye_find_chromium)" || {
  echo "[错误] 未找到 Chromium/Chrome，请安装: sudo apt install chromium-browser"
  exit 1
}

if command -v unclutter >/dev/null 2>&1; then
  pkill -u "$(id -un)" -x unclutter 2>/dev/null || true
  unclutter -idle 0 -root &
fi

# shellcheck disable=SC2046
exec "$CHROMIUM" $(markeye_chromium_kiosk_flags "$APP_URL")
