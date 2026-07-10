# MarkEye 产线部署共享函数（由其他 deploy 脚本 source）
# shellcheck shell=bash

markeye_deploy_root() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cd "$script_dir/.." && pwd
}

markeye_find_chromium() {
  local candidate
  for candidate in chromium-browser chromium google-chrome-stable google-chrome; do
    if command -v "$candidate" >/dev/null 2>&1; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

markeye_wait_for_health() {
  local url="${1:-http://127.0.0.1:8080/api/health}"
  local timeout="${2:-60}"
  local elapsed=0

  while [ "$elapsed" -lt "$timeout" ]; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    if command -v wget >/dev/null 2>&1 && wget -q -O /dev/null "$url" 2>/dev/null; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  echo "[错误] 服务未在 ${timeout}s 内就绪: $url" >&2
  return 1
}

markeye_systemd_web_active() {
  systemctl is-active --quiet markeye-web 2>/dev/null
}

markeye_ensure_venv() {
  local root="$1"
  local install_deps="${2:-0}"

  if [ ! -d "$root/.venv" ]; then
    echo "[信息] 创建虚拟环境: $root/.venv"
    python3 -m venv "$root/.venv"
    install_deps=1
  fi

  # shellcheck disable=SC1091
  source "$root/.venv/bin/activate"

  if [ "$install_deps" = "1" ]; then
    echo "[信息] 安装 Python 依赖"
    pip install -q -r "$root/requirements.txt"
  fi
}

markeye_chromium_kiosk_flags() {
  local url="${1:-http://127.0.0.1:8080/template/}"
  printf '%s' "--kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --no-first-run --disable-translate --app=${url}"
}

markeye_chromium_dev_flags() {
  local url="${1:-http://127.0.0.1:8080/template/}"
  printf '%s' "--new-window --password-store=basic --no-first-run --disable-translate ${url}"
}

markeye_disable_screensaver() {
  if ! command -v gsettings >/dev/null 2>&1; then
    echo "[警告] 未找到 gsettings，跳过屏保/休眠配置"
    return 0
  fi

  gsettings set org.gnome.desktop.session idle-delay 0 2>/dev/null || true
  gsettings set org.gnome.desktop.screensaver lock-enabled false 2>/dev/null || true
  gsettings set org.gnome.desktop.screensaver idle-activation-enabled false 2>/dev/null || true
  gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type nothing 2>/dev/null || true
  gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-battery-type nothing 2>/dev/null || true
  echo "[信息] 已禁用屏保与自动休眠（当前桌面用户）"
}

markeye_pip_index() {
  printf '%s' "${MARKEYE_PIP_INDEX:-https://pypi.tuna.tsinghua.edu.cn/simple}"
}

markeye_python_deps_ready() {
  local python_bin="$1"
  [ -x "$python_bin" ] || return 1
  "$python_bin" - <<'PY' >/dev/null 2>&1
import cv2
import fastapi
import uvicorn
PY
}

markeye_pip_install() {
  local python_bin="$1"
  local requirements="$2"
  local pip_index
  pip_index="$(markeye_pip_index)"

  echo "[信息] pip 镜像: $pip_index"
  "$python_bin" -m pip install --upgrade pip
  "$python_bin" -m pip install \
    -r "$requirements" \
    -i "$pip_index" \
    --default-timeout=120 \
    --retries=10
}
