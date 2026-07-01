#!/usr/bin/env bash
# MarkEye Web 服务启动脚本（Linux / macOS 开发）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "========================================"
echo "  MarkEye Web 服务"
echo "========================================"
echo

if [ -f ".venv/bin/activate" ]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
  echo "[OK] 已激活虚拟环境 .venv"
else
  echo "[提示] 未找到 .venv，使用系统 Python"
fi

if ! command -v python3 >/dev/null 2>&1 && ! command -v python >/dev/null 2>&1; then
  echo "[错误] 未找到 python3/python，请先安装 Python 3.10+"
  exit 1
fi

PY="${PYTHON:-}"
if [ -z "$PY" ]; then
  if command -v python3 >/dev/null 2>&1; then
    PY=python3
  else
    PY=python
  fi
fi

echo
echo "启动中..."
echo "  UI:   http://localhost:8080/template/"
echo "  Mock: http://localhost:8080/template/?mock=0"
echo
echo "按 Ctrl+C 停止服务。"
echo "----------------------------------------"
echo

exec "$PY" -m src.web_server
