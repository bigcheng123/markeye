#!/bin/bash
# 修复开发模式开机问题：GDM 自动登录、同步脚本、立即启动后端与浏览器
set -euo pipefail

DEV_USER="${1:-trg-327}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_DIR="${MARKEYE_INSTALL_DIR:-/opt/markeye}"
KIOSK_USER="${MARKEYE_KIOSK_USER:-markeye}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "[错误] 请使用 sudo 运行: sudo $0 [$DEV_USER]" >&2
  exit 1
fi

if ! id "$DEV_USER" >/dev/null 2>&1; then
  echo "[错误] 用户不存在: $DEV_USER" >&2
  exit 1
fi

echo "[fix-dev-boot] 开发用户: $DEV_USER"
echo "[fix-dev-boot] 同步 deploy 脚本到 $INSTALL_DIR/deploy/"
rsync -a "$REPO_ROOT/deploy/" "$INSTALL_DIR/deploy/"
chmod +x "$INSTALL_DIR/deploy/"*.sh 2>/dev/null || true

echo "[fix-dev-boot] 修复 GDM 自动登录"
CONF="/etc/gdm3/custom.conf"
if [[ -f "$CONF" ]]; then
  sed -i '/^AutomaticLoginEnable=/d; /^AutomaticLogin=/d' "$CONF"
  sed -i "/^\[daemon\]/a AutomaticLogin=${DEV_USER}" "$CONF"
  sed -i "/^\[daemon\]/a AutomaticLoginEnable=true" "$CONF"
fi

echo "[fix-dev-boot] 应用开发用户 sudo/systemd 配置"
"$INSTALL_DIR/deploy/apply-dev-user.sh" "$DEV_USER"

echo "[fix-dev-boot] 确保 dev autostart desktop 存在"
DEV_AUTOSTART="/home/$DEV_USER/.config/autostart"
mkdir -p "$DEV_AUTOSTART"
sed "s|@INSTALL_DIR@|$INSTALL_DIR|g; s|@KIOSK_USER@|$KIOSK_USER|g" \
  "$INSTALL_DIR/deploy/markeye-dev-web.desktop" >"$DEV_AUTOSTART/markeye-dev-web.desktop"
sed "s|@INSTALL_DIR@|$INSTALL_DIR|g" \
  "$INSTALL_DIR/deploy/markeye-dev-browser.desktop" >"$DEV_AUTOSTART/markeye-dev-browser.desktop"
chown -R "$DEV_USER:$DEV_USER" "/home/$DEV_USER/.config"

echo "[fix-dev-boot] 立即启动后端（markeye 用户）"
sudo -u "$KIOSK_USER" "$INSTALL_DIR/deploy/dev-web.sh" || true
sleep 3
if curl -fsS "http://127.0.0.1:8080/api/health" >/dev/null 2>&1; then
  echo "[fix-dev-boot] 后端已就绪"
  if [[ "${DISPLAY:-}" != "" ]] && [[ "$(whoami)" == "$DEV_USER" || -n "${SUDO_USER:-}" ]]; then
    runuser -u "$DEV_USER" -- "$INSTALL_DIR/deploy/dev-browser.sh" &
  else
    echo "[fix-dev-boot] 浏览器请登录 $DEV_USER 后自动打开，或手动运行:"
    echo "  $INSTALL_DIR/deploy/dev-browser.sh"
  fi
else
  echo "[fix-dev-boot] 后端未就绪，请查看日志:"
  echo "  /home/$KIOSK_USER/.local/share/markeye/dev-web.log"
fi

cat <<EOF

修复完成。

说明:
  - 开发模式项目目录在 $INSTALL_DIR（不是家目录下的 syncfolder）
  - 源码开发目录仍在 /home/$DEV_USER/syncfolder/markeye
  - 下次开机会自动登录 $DEV_USER 并自启后端+浏览器

若当前仍在 markeye 桌面: 注销后应自动进入 $DEV_USER。
或执行: sudo reboot

EOF
