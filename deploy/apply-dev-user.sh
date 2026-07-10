#!/bin/bash
# 配置开发模式桌面用户（本机无 ubuntu 用户时使用，如 trg-327）
set -euo pipefail

DEV_USER="${1:-trg-327}"
INSTALL_DIR="${MARKEYE_INSTALL_DIR:-/opt/markeye}"
KIOSK_USER="${MARKEYE_KIOSK_USER:-markeye}"
DROPIN_DIR="/etc/systemd/system/markeye-mode-switch@.service.d"
DROPIN_FILE="$DROPIN_DIR/dev-user.conf"
SUDOERS_FILE="/etc/sudoers.d/markeye-mode-switch"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "[错误] 请使用 sudo 运行: sudo $0 [$DEV_USER]" >&2
  exit 1
fi

if ! id "$DEV_USER" >/dev/null 2>&1; then
  echo "[错误] 用户不存在: $DEV_USER" >&2
  exit 1
fi

if ! id "$KIOSK_USER" >/dev/null 2>&1; then
  echo "[错误] kiosk 用户不存在: $KIOSK_USER" >&2
  exit 1
fi

echo "[apply-dev-user] 开发模式桌面用户: $DEV_USER"
echo "[apply-dev-user] kiosk 用户: $KIOSK_USER"
echo "[apply-dev-user] 安装目录: $INSTALL_DIR"

mkdir -p "$DROPIN_DIR"
cat >"$DROPIN_FILE" <<EOF
[Service]
Environment=MARKEYE_DEV_USER=$DEV_USER
Environment=MARKEYE_KIOSK_USER=$KIOSK_USER
Environment=MARKEYE_INSTALL_DIR=$INSTALL_DIR
EOF
chmod 0644 "$DROPIN_FILE"

for grp in "$KIOSK_USER" video dialout plugdev; do
  if getent group "$grp" >/dev/null 2>&1; then
    usermod -aG "$grp" "$DEV_USER" 2>/dev/null || true
  fi
done

DEV_WEB_CMD="$INSTALL_DIR/deploy/dev-web.sh"
SUDOERS_LINE="$DEV_USER ALL=($KIOSK_USER) NOPASSWD: $DEV_WEB_CMD"

if [[ ! -f "$SUDOERS_FILE" ]]; then
  echo "[错误] 未找到 $SUDOERS_FILE，请先运行 sudo ./deploy/install-kiosk.sh" >&2
  exit 1
fi

sed -i 's/\r$//' "$SUDOERS_FILE"
if ! grep -Fq "$SUDOERS_LINE" "$SUDOERS_FILE"; then
  echo "$SUDOERS_LINE" >>"$SUDOERS_FILE"
fi

visudo -c

systemctl daemon-reload

cat <<EOF

配置完成。

下一步（会触发系统自动重启）:
  curl -fsS -X POST "http://127.0.0.1:8080/api/system/mode" \\
    -H "Content-Type: application/json" \\
    -d '{"mode":"dev"}'

重启后验收:
  rg "AutomaticLogin" /etc/gdm3/custom.conf
  ls -la /home/$DEV_USER/.config/autostart | rg markeye-dev
  systemctl is-enabled markeye-web || true
  curl -fsS http://127.0.0.1:8080/api/health

EOF
