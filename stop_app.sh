#!/usr/bin/env bash
# 停止占用 8080 端口的 MarkEye Web 服务（Linux / macOS）
set -euo pipefail

PORT="${1:-8080}"

echo "========================================"
echo "  MarkEye Web Server - Stop"
echo "========================================"
echo

echo "[1/3] Requesting graceful shutdown (POST /api/system/shutdown)..."
if command -v curl >/dev/null 2>&1; then
  curl -s -m 3 -X POST "http://127.0.0.1:${PORT}/api/system/shutdown" >/dev/null 2>&1 || true
elif command -v wget >/dev/null 2>&1; then
  wget -q -T 3 --post-data="" "http://127.0.0.1:${PORT}/api/system/shutdown" -O /dev/null 2>&1 || true
else
  echo "  curl/wget not found, skipping graceful shutdown."
fi

echo "[2/3] Waiting for process to exit..."
sleep 2

echo "[3/3] Stopping service on port ${PORT}..."
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
