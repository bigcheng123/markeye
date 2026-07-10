#!/bin/bash
# MarkEye 开发模式浏览器自启（普通窗口，非 kiosk）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

APP_URL="${MARKEYE_APP_URL:-http://127.0.0.1:8080/template/}"
HEALTH_URL="${MARKEYE_HEALTH_URL:-http://127.0.0.1:8080/api/health}"
HEALTH_TIMEOUT="${MARKEYE_HEALTH_TIMEOUT:-120}"

export DISPLAY="${DISPLAY:-:0}"

markeye_wait_for_health "$HEALTH_URL" "$HEALTH_TIMEOUT"

CHROMIUM="$(markeye_find_chromium)" || {
  echo "[错误] 未找到 Chromium/Chrome，请安装: sudo apt install chromium-browser"
  exit 1
}

# 自动登录不会输入密码，GNOME 密钥环保持锁定；Chrome 默认走 gnome-libsecret 会弹解锁窗。
# 开发模式访问本地 MarkEye 无需保存密码，使用 basic 存储避免密钥环认证。
# shellcheck disable=SC2046
exec "$CHROMIUM" $(markeye_chromium_dev_flags "$APP_URL")
