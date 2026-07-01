#!/usr/bin/env bash
# 停止占用 8080 端口的 MarkEye Web 服务（Linux / macOS）
set -euo pipefail

PORT="${1:-8080}"

echo "========================================"
echo "  MarkEye Web Server - Stop"
echo "========================================"
echo
echo "Stopping service on port ${PORT}..."

if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
elif command -v lsof >/dev/null 2>&1; then
  PIDS=$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "${PIDS}" ]; then
    # shellcheck disable=SC2086
    kill ${PIDS} 2>/dev/null || true
  fi
else
  echo "[提示] 未找到 fuser/lsof，请手动结束监听 ${PORT} 的进程。"
  exit 1
fi

echo
echo "Done."
