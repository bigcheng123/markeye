#!/bin/bash
# MarkEye 开发模式后端自启（非 systemd，供 XDG autostart 调用）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"
ROOT="$(markeye_deploy_root)"
PY="$ROOT/.venv/bin/python"

cd "$ROOT"

if markeye_systemd_web_active; then
  echo "[dev-web] markeye-web.service 已在运行，跳过"
  exit 0
fi

if curl -fsS "http://127.0.0.1:8080/api/health" >/dev/null 2>&1; then
  echo "[dev-web] 后端已就绪，跳过"
  exit 0
fi

if [[ ! -x "$PY" ]]; then
  echo "[dev-web] 未找到虚拟环境: $PY" >&2
  exit 1
fi

LOG_DIR="${HOME}/.local/share/markeye"
mkdir -p "$LOG_DIR"
LOG_FILE="${LOG_DIR}/dev-web.log"

{
  echo "=== dev-web $(date -Iseconds) user=$(id -un) pwd=$(pwd) ==="
  nohup "$PY" -m src.web_server &
  echo $! >"${LOG_DIR}/dev-web.pid"
  echo "[dev-web] 已后台启动 web_server (PID $(cat "${LOG_DIR}/dev-web.pid")), 日志: $LOG_FILE"
} >>"$LOG_FILE" 2>&1
