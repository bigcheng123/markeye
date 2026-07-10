#!/bin/bash
# Root helper: switch MarkEye between prod/dev modes and reboot.
set -euo pipefail

MODE="${1:-}"
if [[ "$MODE" != "prod" && "$MODE" != "dev" ]]; then
  echo "[mode-switch] invalid mode: $MODE" >&2
  exit 2
fi

INSTALL_DIR="${MARKEYE_INSTALL_DIR:-/opt/markeye}"
KIOSK_USER="${MARKEYE_KIOSK_USER:-markeye}"
DEV_USER="${MARKEYE_DEV_USER:-ubuntu}"

KIOSK_HOME="$(getent passwd "$KIOSK_USER" | cut -d: -f6 || true)"
if [[ -z "$KIOSK_HOME" ]]; then
  KIOSK_HOME="/home/$KIOSK_USER"
fi
AUTOSTART_DIR="$KIOSK_HOME/.config/autostart"

DEV_HOME="$(getent passwd "$DEV_USER" | cut -d: -f6 || true)"
DEV_AUTOSTART_DIR="${DEV_HOME:+$DEV_HOME/.config/autostart}"

KIOSK_DESKTOP="$AUTOSTART_DIR/markeye-kiosk.desktop"
HARDEN_DESKTOP="$AUTOSTART_DIR/markeye-kiosk-harden.desktop"
DEV_WEB_DESKTOP="${DEV_AUTOSTART_DIR}/markeye-dev-web.desktop"
DEV_BROWSER_DESKTOP="${DEV_AUTOSTART_DIR}/markeye-dev-browser.desktop"

log() { echo "[mode-switch] $*"; }

ensure_kiosk_dirs() {
  mkdir -p "$AUTOSTART_DIR"
  chown -R "$KIOSK_USER:$KIOSK_USER" "$KIOSK_HOME/.config" || true
}

ensure_dev_dirs() {
  if [[ -z "$DEV_AUTOSTART_DIR" ]]; then
    echo "[mode-switch] 开发用户不存在: $DEV_USER" >&2
    exit 1
  fi
  mkdir -p "$DEV_AUTOSTART_DIR"
  chown -R "$DEV_USER:$DEV_USER" "$DEV_HOME/.config" || true
}

set_gdm_autologin() {
  local enabled="$1"
  local user="$2"
  local conf="/etc/gdm3/custom.conf"
  [[ -f "$conf" ]] || return 0

  # 删除旧项，避免 rg 不可用或多次切换时重复追加
  sed -i '/^AutomaticLoginEnable=/d; /^AutomaticLogin=/d' "$conf"
  sed -i "/^\[daemon\]/a AutomaticLogin=${user}" "$conf"
  sed -i "/^\[daemon\]/a AutomaticLoginEnable=${enabled}" "$conf"
}

install_autostart_prod() {
  ensure_kiosk_dirs
  sed "s|/opt/markeye|$INSTALL_DIR|g" "$INSTALL_DIR/deploy/markeye-kiosk.desktop" > "$KIOSK_DESKTOP"
  cp "$INSTALL_DIR/deploy/markeye-kiosk-harden.desktop" "$HARDEN_DESKTOP"
  sed -i "s|/opt/markeye|$INSTALL_DIR|g" "$HARDEN_DESKTOP"
  chown "$KIOSK_USER:$KIOSK_USER" "$KIOSK_DESKTOP" "$HARDEN_DESKTOP" || true
}

disable_autostart_prod() {
  ensure_kiosk_dirs
  if [[ -f "$KIOSK_DESKTOP" ]]; then mv -f "$KIOSK_DESKTOP" "${KIOSK_DESKTOP}.disabled" || true; fi
  if [[ -f "$HARDEN_DESKTOP" ]]; then mv -f "$HARDEN_DESKTOP" "${HARDEN_DESKTOP}.disabled" || true; fi
}

install_autostart_dev() {
  ensure_dev_dirs
  sed "s|@INSTALL_DIR@|$INSTALL_DIR|g; s|@KIOSK_USER@|$KIOSK_USER|g" \
    "$INSTALL_DIR/deploy/markeye-dev-web.desktop" > "$DEV_WEB_DESKTOP"
  sed "s|@INSTALL_DIR@|$INSTALL_DIR|g" \
    "$INSTALL_DIR/deploy/markeye-dev-browser.desktop" > "$DEV_BROWSER_DESKTOP"
  chown "$DEV_USER:$DEV_USER" "$DEV_WEB_DESKTOP" "$DEV_BROWSER_DESKTOP" || true
}

disable_autostart_dev() {
  [[ -n "$DEV_AUTOSTART_DIR" ]] || return 0
  mkdir -p "$DEV_AUTOSTART_DIR"
  if [[ -f "$DEV_WEB_DESKTOP" ]]; then mv -f "$DEV_WEB_DESKTOP" "${DEV_WEB_DESKTOP}.disabled" || true; fi
  if [[ -f "$DEV_BROWSER_DESKTOP" ]]; then mv -f "$DEV_BROWSER_DESKTOP" "${DEV_BROWSER_DESKTOP}.disabled" || true; fi
}

ensure_dev_user_groups() {
  if ! id "$DEV_USER" >/dev/null 2>&1; then
    echo "[mode-switch] 开发用户不存在: $DEV_USER" >&2
    exit 1
  fi
  for grp in "$KIOSK_USER" video dialout plugdev; do
    if getent group "$grp" >/dev/null 2>&1; then
      usermod -aG "$grp" "$DEV_USER" 2>/dev/null || true
    fi
  done
}

switch_to_prod() {
  log "switching to prod"
  disable_autostart_dev
  systemctl enable --now markeye-web.service || systemctl restart markeye-web.service
  install_autostart_prod
  set_gdm_autologin "true" "$KIOSK_USER"
  if [[ -x "$INSTALL_DIR/deploy/kiosk-harden.sh" ]]; then
    sudo -u "$KIOSK_USER" "$INSTALL_DIR/deploy/kiosk-harden.sh" || true
  fi
}

switch_to_dev() {
  log "switching to dev"
  ensure_dev_user_groups
  systemctl disable --now markeye-web.service 2>/dev/null || true
  disable_autostart_prod
  install_autostart_dev
  set_gdm_autologin "true" "$DEV_USER"
}

if [[ "$MODE" == "prod" ]]; then
  switch_to_prod
else
  switch_to_dev
fi

sync || true
log "rebooting"
reboot
