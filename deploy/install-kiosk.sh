#!/bin/bash
# MarkEye 产线 kiosk 一键安装（方案 B：systemd + XDG autostart）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"
SOURCE_ROOT="$(markeye_deploy_root)"

INSTALL_DIR="/opt/markeye"
KIOSK_USER="markeye"
DEV_USER="ubuntu"
DRY_RUN=0
SKIP_COPY=0
SKIP_PIP=0
REUSE_DEV_VENV=0

usage() {
  cat <<'EOF'
用法: sudo ./deploy/install-kiosk.sh [选项]

将 MarkEye 安装到产线机并配置开机自启（方案 B）。

选项:
  --install-dir PATH   安装目录（默认 /opt/markeye）
  --user NAME          kiosk 系统用户（默认 markeye）
  --dev-user NAME      开发模式桌面用户（默认 ubuntu；本机无 ubuntu 时用 trg-327 等）
  --skip-copy          跳过文件复制（目标目录已存在且为当前仓库）
  --skip-pip           跳过 pip install（venv 依赖已就绪时使用）
  --reuse-dev-venv     复用当前仓库 .venv（避免产线机重新下载 opencv）
  --pip-index URL      pip 镜像（默认清华源，可用 MARKEYE_PIP_INDEX 环境变量）
  --dry-run            仅打印将执行的操作
  -h, --help           显示帮助

安装内容:
  1. 复制项目到安装目录并创建 Python venv
  2. 安装 systemd 单元 markeye-web.service
  3. 配置 kiosk 用户 XDG autostart（Chromium 全屏）
  4. 配置 GDM 自动登录（如存在）
  5. 禁用屏保/休眠；注册 kiosk 加固 autostart

产线维护:
  sudo systemctl status markeye-web
  sudo systemctl restart markeye-web
  /opt/markeye/stop_app.sh

轻量 kiosk（2GB 内存）:
  sudo ./deploy/kiosk-openbox.sh
EOF
}

log() {
  echo "[install-kiosk] $*"
}

run() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "[dry-run] $*"
  else
    "$@"
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --install-dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --user)
      KIOSK_USER="$2"
      shift 2
      ;;
    --dev-user)
      DEV_USER="$2"
      shift 2
      ;;
    --skip-copy)
      SKIP_COPY=1
      shift
      ;;
    --skip-pip)
      SKIP_PIP=1
      shift
      ;;
    --reuse-dev-venv)
      REUSE_DEV_VENV=1
      shift
      ;;
    --pip-index)
      MARKEYE_PIP_INDEX="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ "$(id -u)" -ne 0 ] && [ "$DRY_RUN" = "0" ]; then
  echo "[错误] 请使用 sudo 运行: sudo $SCRIPT_DIR/install-kiosk.sh" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "[错误] 未找到 python3" >&2
  exit 1
fi

log "安装目录: $INSTALL_DIR"
log "kiosk 用户: $KIOSK_USER"
log "开发模式用户: $DEV_USER"

if ! id "$KIOSK_USER" >/dev/null 2>&1; then
  log "创建系统用户 $KIOSK_USER"
  run useradd --create-home --shell /bin/bash --user-group "$KIOSK_USER"
else
  log "用户 $KIOSK_USER 已存在"
fi

for grp in video dialout plugdev; do
  if getent group "$grp" >/dev/null 2>&1; then
    run usermod -aG "$grp" "$KIOSK_USER"
  fi
done

if [ "$SKIP_COPY" = "1" ]; then
  log "跳过复制（--skip-copy）"
elif [ "$SOURCE_ROOT" != "$INSTALL_DIR" ]; then
  log "复制项目到 $INSTALL_DIR"
  run mkdir -p "$INSTALL_DIR"
  run rsync -a --delete \
    --exclude '.venv' \
    --exclude '.git' \
    --exclude '__pycache__' \
    --exclude '*.pyc' \
    "$SOURCE_ROOT/" "$INSTALL_DIR/"
else
  log "源目录即安装目录，跳过复制"
fi

run mkdir -p "$INSTALL_DIR"
run chown -R "$KIOSK_USER:$KIOSK_USER" "$INSTALL_DIR"

markeye_venv_ready() {
  [ -x "$INSTALL_DIR/.venv/bin/python" ] \
    && "$INSTALL_DIR/.venv/bin/python" -m pip --version >/dev/null 2>&1
}

if [ "$REUSE_DEV_VENV" = "1" ] && [ "$DRY_RUN" = "0" ]; then
  if [ -x "$SOURCE_ROOT/.venv/bin/python" ] && markeye_python_deps_ready "$SOURCE_ROOT/.venv/bin/python"; then
    log "复用开发目录虚拟环境: $SOURCE_ROOT/.venv"
    rm -rf "$INSTALL_DIR/.venv"
    rsync -a "$SOURCE_ROOT/.venv/" "$INSTALL_DIR/.venv/"
    chown -R "$KIOSK_USER:$KIOSK_USER" "$INSTALL_DIR/.venv"
    SKIP_PIP=1
  else
    echo "[错误] --reuse-dev-venv 需要开发目录存在且依赖已安装: $SOURCE_ROOT/.venv" >&2
    exit 1
  fi
elif [ "$REUSE_DEV_VENV" = "1" ]; then
  log "将复用开发目录虚拟环境: $SOURCE_ROOT/.venv"
fi

if [ "$DRY_RUN" = "0" ]; then
  if ! python3 -m venv --help >/dev/null 2>&1; then
    echo "[错误] 缺少 python3-venv，请先安装: sudo apt install python3-venv python3-pip" >&2
    exit 1
  fi

  if ! markeye_venv_ready; then
    if [ -d "$INSTALL_DIR/.venv" ]; then
      log "虚拟环境不完整（缺少 pip），重新创建"
      rm -rf "$INSTALL_DIR/.venv"
    else
      log "创建虚拟环境"
    fi
    runuser -u "$KIOSK_USER" -- python3 -m venv "$INSTALL_DIR/.venv" 2>/dev/null \
      || sudo -u "$KIOSK_USER" python3 -m venv "$INSTALL_DIR/.venv"
    if ! markeye_venv_ready; then
      echo "[错误] 虚拟环境创建失败，请确认已安装 python3-venv" >&2
      exit 1
    fi
  else
    log "虚拟环境已就绪"
  fi

  if [ "$SKIP_PIP" = "1" ]; then
    if markeye_python_deps_ready "$INSTALL_DIR/.venv/bin/python"; then
      log "跳过 pip install（依赖已就绪）"
    else
      echo "[错误] --skip-pip 指定但依赖未安装完整，请去掉 --skip-pip 或先安装依赖" >&2
      exit 1
    fi
  elif markeye_python_deps_ready "$INSTALL_DIR/.venv/bin/python"; then
    log "Python 依赖已满足，跳过 pip install"
  else
    PIP_INDEX="$(markeye_pip_index)"
    log "安装 Python 依赖（镜像: $PIP_INDEX，opencv 包较大请耐心等待）"
    runuser -u "$KIOSK_USER" -- "$INSTALL_DIR/.venv/bin/python" -m pip install --upgrade pip
    runuser -u "$KIOSK_USER" -- "$INSTALL_DIR/.venv/bin/python" -m pip install \
      -r "$INSTALL_DIR/requirements.txt" \
      -i "$PIP_INDEX" \
      --default-timeout=120 \
      --retries=10
  fi
else
  log "将创建/校验 venv 并 pip install -r requirements.txt"
fi

run chown -R "$KIOSK_USER:$KIOSK_USER" "$INSTALL_DIR"

log "安装 systemd 单元 markeye-web.service"
if [ "$DRY_RUN" = "0" ]; then
  sed "s|/opt/markeye|$INSTALL_DIR|g; s|User=markeye|User=$KIOSK_USER|g; s|Group=markeye|Group=$KIOSK_USER|g" \
    "$SCRIPT_DIR/markeye-web.service" > /etc/systemd/system/markeye-web.service
else
  echo "[dry-run] 写入 /etc/systemd/system/markeye-web.service"
fi

log "安装模式切换 helper（markeye-mode-switch@.service + sudoers）"
if [ "$DRY_RUN" = "0" ]; then
  cp "$SCRIPT_DIR/markeye-mode-switch@.service" /etc/systemd/system/markeye-mode-switch@.service
  chmod 0644 /etc/systemd/system/markeye-mode-switch@.service
  mkdir -p /etc/systemd/system/markeye-mode-switch@.service.d
  cat >/etc/systemd/system/markeye-mode-switch@.service.d/dev-user.conf <<EOF
[Service]
Environment=MARKEYE_DEV_USER=$DEV_USER
Environment=MARKEYE_KIOSK_USER=$KIOSK_USER
Environment=MARKEYE_INSTALL_DIR=$INSTALL_DIR
EOF
  chmod 0644 /etc/systemd/system/markeye-mode-switch@.service.d/dev-user.conf
  # allow markeye-web (unprivileged) to trigger the helper via sudo;
  # allow dev desktop user autostart to launch backend as kiosk user
  sed "s/^markeye /$KIOSK_USER /; s|(markeye)|($KIOSK_USER)|g; s|^ubuntu |$DEV_USER |; s|/opt/markeye|$INSTALL_DIR|g" \
    "$SCRIPT_DIR/markeye-mode-switch.sudoers" > /etc/sudoers.d/markeye-mode-switch
  chmod 0440 /etc/sudoers.d/markeye-mode-switch
  if id "$DEV_USER" >/dev/null 2>&1; then
    for grp in "$KIOSK_USER" video dialout plugdev; do
      if getent group "$grp" >/dev/null 2>&1; then
        usermod -aG "$grp" "$DEV_USER" 2>/dev/null || true
      fi
    done
  else
    log "警告: 开发用户 $DEV_USER 不存在，切到 dev 模式前请创建或运行 deploy/apply-dev-user.sh"
  fi
else
  echo "[dry-run] 写入 /etc/systemd/system/markeye-mode-switch@.service"
  echo "[dry-run] 写入 /etc/systemd/system/markeye-mode-switch@.service.d/dev-user.conf (MARKEYE_DEV_USER=$DEV_USER)"
  echo "[dry-run] 写入 /etc/sudoers.d/markeye-mode-switch"
fi

if [ -f /etc/systemd/system/markeye.service ] && [ "$DRY_RUN" = "0" ]; then
  log "检测到旧单元 markeye.service，停用以避免与 markeye-web 争抢 8080"
  systemctl disable --now markeye.service 2>/dev/null || true
fi

run chmod +x "$INSTALL_DIR/deploy/kiosk-browser.sh"
run chmod +x "$INSTALL_DIR/deploy/kiosk-harden.sh"
run chmod +x "$INSTALL_DIR/deploy/kiosk.sh"
run chmod +x "$INSTALL_DIR/deploy/verify-kiosk.sh"
run chmod +x "$INSTALL_DIR/deploy/dev-web.sh"
run chmod +x "$INSTALL_DIR/deploy/dev-browser.sh"
run chmod +x "$INSTALL_DIR/deploy/mode-switch.sh" 2>/dev/null || true

KIOSK_HOME=""
if getent passwd "$KIOSK_USER" >/dev/null 2>&1; then
  KIOSK_HOME="$(getent passwd "$KIOSK_USER" | cut -d: -f6)"
fi
if [ -z "$KIOSK_HOME" ]; then
  KIOSK_HOME="/home/$KIOSK_USER"
fi
AUTOSTART_DIR="$KIOSK_HOME/.config/autostart"
log "配置 XDG autostart: $AUTOSTART_DIR"
run mkdir -p "$AUTOSTART_DIR"
if [ "$DRY_RUN" = "0" ]; then
  sed "s|/opt/markeye|$INSTALL_DIR|g" "$SCRIPT_DIR/markeye-kiosk.desktop" > "$AUTOSTART_DIR/markeye-kiosk.desktop"
  cp "$SCRIPT_DIR/markeye-kiosk-harden.desktop" "$AUTOSTART_DIR/markeye-kiosk-harden.desktop"
  sed -i "s|/opt/markeye|$INSTALL_DIR|g" "$AUTOSTART_DIR/markeye-kiosk-harden.desktop"
  chown -R "$KIOSK_USER:$KIOSK_USER" "$KIOSK_HOME/.config"
else
  echo "[dry-run] 写入 $AUTOSTART_DIR/markeye-kiosk.desktop"
  echo "[dry-run] 写入 $AUTOSTART_DIR/markeye-kiosk-harden.desktop"
fi

if [ -f /etc/gdm3/custom.conf ]; then
  log "配置 GDM3 自动登录用户 $KIOSK_USER"
  if [ "$DRY_RUN" = "0" ]; then
    if grep -q '^AutomaticLoginEnable=' /etc/gdm3/custom.conf; then
      sed -i "s/^AutomaticLoginEnable=.*/AutomaticLoginEnable=true/" /etc/gdm3/custom.conf
    else
      sed -i "/^\[daemon\]/a AutomaticLoginEnable=true" /etc/gdm3/custom.conf
    fi
    if grep -q '^AutomaticLogin=' /etc/gdm3/custom.conf; then
      sed -i "s/^AutomaticLogin=.*/AutomaticLogin=$KIOSK_USER/" /etc/gdm3/custom.conf
    else
      sed -i "/^\[daemon\]/a AutomaticLogin=$KIOSK_USER" /etc/gdm3/custom.conf
    fi
  else
    echo "[dry-run] 更新 /etc/gdm3/custom.conf AutomaticLogin=$KIOSK_USER"
  fi
elif [ -f /etc/lightdm/lightdm.conf ]; then
  log "配置 LightDM 自动登录用户 $KIOSK_USER"
  if [ "$DRY_RUN" = "0" ]; then
    if grep -q '^autologin-user=' /etc/lightdm/lightdm.conf; then
      sed -i "s/^autologin-user=.*/autologin-user=$KIOSK_USER/" /etc/lightdm/lightdm.conf
    else
      printf '\nautologin-user=%s\nautologin-user-timeout=0\n' "$KIOSK_USER" >> /etc/lightdm/lightdm.conf
    fi
  else
    echo "[dry-run] 更新 /etc/lightdm/lightdm.conf autologin-user=$KIOSK_USER"
  fi
else
  log "未检测到 GDM3/LightDM，请手动配置桌面自动登录"
fi

run systemctl daemon-reload
run systemctl enable markeye-web.service
if [ "$DRY_RUN" = "0" ]; then
  systemctl stop markeye-web.service 2>/dev/null || true
  systemctl restart markeye-web.service || systemctl start markeye-web.service
fi

if [ "$DRY_RUN" = "0" ]; then
  if command -v runuser >/dev/null 2>&1; then
    runuser -u "$KIOSK_USER" -- "$INSTALL_DIR/deploy/kiosk-harden.sh" || true
  elif command -v sudo >/dev/null 2>&1; then
    sudo -u "$KIOSK_USER" "$INSTALL_DIR/deploy/kiosk-harden.sh" || true
  fi
fi

cat <<EOF

安装完成。

下一步:
  1. 重启产线机: sudo reboot
  2. 重启后应自动登录 $KIOSK_USER，并全屏打开 MarkEye
  3. 健康检查: curl http://127.0.0.1:8080/api/health
  4. 冒烟测试: $INSTALL_DIR/smoke/run_smoke.sh

注意:
  - 产线请勿同时运行 deploy/kiosk.sh 与 markeye-web.service
  - 维护停机: $INSTALL_DIR/stop_app.sh 或 sudo systemctl stop markeye-web

EOF
