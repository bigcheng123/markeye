#!/bin/bash
# MarkEye 轻量 kiosk 安装（方案 C：openbox + xinit，适合 2GB 内存产线机）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

INSTALL_DIR="/opt/markeye"
KIOSK_USER="markeye"
DRY_RUN=0

usage() {
  cat <<'EOF'
用法: sudo ./deploy/kiosk-openbox.sh [选项]

在已执行 install-kiosk.sh 的基础上，为 kiosk 用户配置 openbox + startx 轻量全屏会话。
适用于 J1900 / 2GB 内存专用产线机。

选项:
  --install-dir PATH   安装目录（默认 /opt/markeye）
  --user NAME          kiosk 用户（默认 markeye）
  --dry-run            仅打印将执行的操作
  -h, --help           显示帮助

说明:
  - 后端仍由 markeye-web.service 守护
  - 图形会话改为 startx + openbox + Chromium kiosk
  - 需安装: sudo apt install openbox xinit unclutter chromium-browser
EOF
}

log() {
  echo "[kiosk-openbox] $*"
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
  echo "[错误] 请使用 sudo 运行" >&2
  exit 1
fi

KIOSK_HOME=""
if getent passwd "$KIOSK_USER" >/dev/null 2>&1; then
  KIOSK_HOME="$(getent passwd "$KIOSK_USER" | cut -d: -f6)"
fi
if [ -z "$KIOSK_HOME" ]; then
  if [ "$DRY_RUN" = "1" ]; then
    KIOSK_HOME="/home/$KIOSK_USER"
  else
    echo "[错误] 用户 $KIOSK_USER 不存在，请先运行 install-kiosk.sh" >&2
    exit 1
  fi
fi

XINITRC="$KIOSK_HOME/.xinitrc"
XSESSION="$KIOSK_HOME/.xsession"
BASH_PROFILE="$KIOSK_HOME/.bash_profile"
BASH_LOGIN="$KIOSK_HOME/.bash_login"

log "配置 openbox kiosk 会话: $KIOSK_USER"

XINITRC_CONTENT="#!/bin/sh
# MarkEye openbox kiosk — 由 deploy/kiosk-openbox.sh 生成
if command -v unclutter >/dev/null 2>&1; then
  unclutter -idle 0 -root &
fi
exec openbox-session &
sleep 1
exec ${INSTALL_DIR}/deploy/kiosk-browser.sh
"

if [ "$DRY_RUN" = "0" ]; then
  printf '%s' "$XINITRC_CONTENT" > "$XINITRC"
  chmod +x "$XINITRC"
  printf '%s\n' "#!/bin/sh" "exec startx" > "$XSESSION"
  chmod +x "$XSESSION"

  STARTX_SNIPPET='# MarkEye openbox kiosk autostart
if [ -z "$DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ]; then
  exec startx
fi
'

  for profile in "$BASH_PROFILE" "$BASH_LOGIN"; do
    if [ -f "$profile" ] && grep -q 'MarkEye openbox kiosk autostart' "$profile"; then
      continue
    fi
    if [ -f "$profile" ]; then
      printf '\n%s' "$STARTX_SNIPPET" >> "$profile"
    else
      printf '%s' "$STARTX_SNIPPET" > "$profile"
    fi
  done

  chown "$KIOSK_USER:$KIOSK_USER" "$XINITRC" "$XSESSION" "$BASH_PROFILE" 2>/dev/null || true
  chown "$KIOSK_USER:$KIOSK_USER" "$BASH_LOGIN" 2>/dev/null || true

  AUTOSTART_DIR="$KIOSK_HOME/.config/autostart"
  if [ -f "$AUTOSTART_DIR/markeye-kiosk.desktop" ]; then
    mv "$AUTOSTART_DIR/markeye-kiosk.desktop" "$AUTOSTART_DIR/markeye-kiosk.desktop.disabled"
    log "已禁用 GNOME autostart 浏览器（改用 xinitrc）"
  fi
else
  echo "[dry-run] 写入 $XINITRC"
  echo "[dry-run] 写入 $XSESSION 与 .bash_profile startx 钩子"
fi

cat <<EOF

openbox kiosk 配置完成。

建议:
  1. 安装依赖: sudo apt install openbox xinit unclutter chromium-browser
  2. 将产线机默认 target 设为 multi-user（非完整 GNOME 桌面）或让 kiosk 用户 tty1 自动登录
  3. 重启后由 startx 启动 openbox + Chromium 全屏

回退 GNOME autostart:
  mv ~/.config/autostart/markeye-kiosk.desktop.disabled ~/.config/autostart/markeye-kiosk.desktop

EOF
