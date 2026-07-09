#!/bin/bash
# MarkEye 产线 kiosk 阶段 1 验证脚本
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"
ROOT="$(markeye_deploy_root)"

FAIL=0

check() {
  local label="$1"
  shift
  if "$@"; then
    echo "[通过] $label"
  else
    echo "[失败] $label" >&2
    FAIL=1
  fi
}

echo "=== MarkEye kiosk 验证 ==="
echo "项目目录: $ROOT"

check "bash 语法: deploy/*.sh" bash -n "$SCRIPT_DIR/kiosk.sh"
check "bash 语法: deploy/lib.sh" bash -n "$SCRIPT_DIR/lib.sh"
check "bash 语法: deploy/kiosk-browser.sh" bash -n "$SCRIPT_DIR/kiosk-browser.sh"
check "bash 语法: deploy/install-kiosk.sh" bash -n "$SCRIPT_DIR/install-kiosk.sh"
check "bash 语法: deploy/kiosk-harden.sh" bash -n "$SCRIPT_DIR/kiosk-harden.sh"
check "bash 语法: deploy/kiosk-openbox.sh" bash -n "$SCRIPT_DIR/kiosk-openbox.sh"

if markeye_find_chromium >/dev/null; then
  echo "[通过] Chromium/Chrome: $(markeye_find_chromium)"
else
  echo "[失败] 未安装 Chromium/Chrome（产线需: sudo apt install chromium-browser）" >&2
  FAIL=1
fi

if command -v unclutter >/dev/null 2>&1; then
  echo "[通过] unclutter 已安装"
else
  echo "[提示] unclutter 未安装（可选: sudo apt install unclutter）"
fi

if markeye_systemd_web_active; then
  echo "[信息] markeye-web.service 已运行，跳过本地临时启动"
  check "健康检查 /api/health" markeye_wait_for_health "http://127.0.0.1:8080/api/health" 5
else
  echo "[信息] 启动临时 Web 服务进行健康检查..."
  markeye_ensure_venv "$ROOT" 0
  python -m src.web_server &
  TMP_PID=$!
  cleanup() {
    if kill -0 "$TMP_PID" 2>/dev/null; then
      curl -fsS -X POST "http://127.0.0.1:8080/api/system/shutdown" >/dev/null 2>&1 || true
      sleep 1
      kill "$TMP_PID" 2>/dev/null || true
      wait "$TMP_PID" 2>/dev/null || true
    fi
  }
  trap cleanup EXIT

  if markeye_wait_for_health "http://127.0.0.1:8080/api/health" 30; then
    echo "[通过] 临时 Web 服务健康检查"
  else
    echo "[失败] 临时 Web 服务未就绪" >&2
    FAIL=1
  fi
fi

if [ "$FAIL" -eq 0 ]; then
  echo ""
  echo "验证通过。产线全屏可手动执行:"
  echo "  $SCRIPT_DIR/kiosk.sh          # 阶段1：一体启动（验证用）"
  echo "  $SCRIPT_DIR/kiosk-browser.sh  # 仅浏览器（需 systemd 已启后端）"
  exit 0
fi

echo ""
echo "验证未全部通过，请根据上方失败项修复后重试。"
exit 1
