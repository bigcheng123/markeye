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
KIOSK_HOME="$(getent passwd "$KIOSK_USER" | cut -d: -f6 || true)"
if [[ -z "$KIOSK_HOME" ]]; then
  KIOSK_HOME="/home/$KIOSK_USER"
fi
AUTOSTART_DIR="$KIOSK_HOME/.config/autostart"

KIOSK_DESKTOP="$AUTOSTART_DIR/markeye-kiosk.desktop"
HARDEN_DESKTOP="$AUTOSTART_DIR/markeye-kiosk-harden.desktop"

log() { echo "[mode-switch] $*"; }

ensure_dirs() {
  mkdir -p "$AUTOSTART_DIR"
  chown -R "$KIOSK_USER:$KIOSK_USER" "$KIOSK_HOME/.config" || true
}

set_gdm_autologin() {
  local enabled="$1"
  local user="$2"
  local conf="/etc/gdm3/custom.conf"
  [[ -f "$conf" ]] || return 0

  if rg -q '^AutomaticLoginEnable=' "$conf"; then
    sed -i "s/^AutomaticLoginEnable=.*/AutomaticLoginEnable=${enabled}/" "$conf"
  else
    sed -i "/^\[daemon\]/a AutomaticLoginEnable=${enabled}" "$conf"
  fi
  if rg -q '^AutomaticLogin=' "$conf"; then
    sed -i "s/^AutomaticLogin=.*/AutomaticLogin=${user}/" "$conf"
  else
    sed -i "/^\[daemon\]/a AutomaticLogin=${user}" "$conf"
  fi
}

install_autostart_prod() {
  ensure_dirs
  sed "s|/opt/markeye|$INSTALL_DIR|g" "$INSTALL_DIR/deploy/markeye-kiosk.desktop" > "$KIOSK_DESKTOP"
  cp "$INSTALL_DIR/deploy/markeye-kiosk-harden.desktop" "$HARDEN_DESKTOP"
  sed -i "s|/opt/markeye|$INSTALL_DIR|g" "$HARDEN_DESKTOP"
  chown "$KIOSK_USER:$KIOSK_USER" "$KIOSK_DESKTOP" "$HARDEN_DESKTOP" || true
}

disable_autostart_dev() {
  ensure_dirs
  if [[ -f "$KIOSK_DESKTOP" ]]; then mv -f "$KIOSK_DESKTOP" "${KIOSK_DESKTOP}.disabled" || true; fi
  if [[ -f "$HARDEN_DESKTOP" ]]; then mv -f "$HARDEN_DESKTOP" "${HARDEN_DESKTOP}.disabled" || true; fi
}

switch_to_prod() {
  log "switching to prod"
  systemctl enable --now markeye-web.service || systemctl restart markeye-web.service
  install_autostart_prod
  set_gdm_autologin "true" "$KIOSK_USER"
  if [[ -x "$INSTALL_DIR/deploy/kiosk-harden.sh" ]]; then
    sudo -u "$KIOSK_USER" "$INSTALL_DIR/deploy/kiosk-harden.sh" || true
  fi
}

switch_to_dev() {
  log "switching to dev"
  systemctl disable --now markeye-web.service 2>/dev/null || true
  disable_autostart_dev
  set_gdm_autologin "false" "$KIOSK_USER"
}

if [[ "$MODE" == "prod" ]]; then
  switch_to_prod
else
  switch_to_dev
fi

sync || true
log "rebooting"
reboot

