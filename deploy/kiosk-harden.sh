#!/bin/bash
# MarkEye kiosk 加固：禁用屏保/休眠，避免与 systemd 双启后端
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

markeye_disable_screensaver

if markeye_systemd_web_active; then
  echo "[信息] markeye-web.service 正在运行（正常）"
else
  echo "[提示] markeye-web.service 未运行；请执行: sudo systemctl enable --now markeye-web"
fi

if pgrep -f "deploy/kiosk\.sh" >/dev/null 2>&1; then
  echo "[警告] 检测到 deploy/kiosk.sh 正在运行；产线请仅使用 systemd + autostart，避免双实例" >&2
  exit 1
fi

echo "[信息] kiosk 加固检查完成"
