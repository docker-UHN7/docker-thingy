#!/usr/bin/env bash
#
# Dev-time installer for the Network Topology feature's privileged helper.
# Not wired into electron-forge packaging yet (see plan notes) - this is a
# manual step while that feature is being built/tested.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER_SRC="$SCRIPT_DIR/resources/linux/docker-thingy-netctl"
POLICY_SRC="$SCRIPT_DIR/resources/linux/dev.dockerthingy.netctl.policy"

HELPER_DEST_DIR="/usr/local/libexec/docker-thingy"
HELPER_DEST="$HELPER_DEST_DIR/netctl"
POLICY_DEST="/usr/share/polkit-1/actions/dev.dockerthingy.netctl.policy"

if [ ! -f "$HELPER_SRC" ] || [ ! -f "$POLICY_SRC" ]; then
  echo "Expected resources not found under $SCRIPT_DIR/resources/linux - run this from the repo." >&2
  exit 1
fi

echo "This will install (with sudo):"
echo "  $HELPER_SRC -> $HELPER_DEST"
echo "  $POLICY_SRC -> $POLICY_DEST"
echo

sudo mkdir -p "$HELPER_DEST_DIR"
sudo install -m 0755 "$HELPER_SRC" "$HELPER_DEST"
sudo install -m 0644 "$POLICY_SRC" "$POLICY_DEST"

if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet polkit.service 2>/dev/null; then
  sudo systemctl reload polkit.service || true
fi

echo
echo "Installed. The app's network-control-service can now invoke:"
echo "  pkexec $HELPER_DEST container-link <pid> up|down"
echo "  pkexec $HELPER_DEST bridge-forward <bridge> allow|deny"
echo
echo "To uninstall: sudo rm -f '$HELPER_DEST' '$POLICY_DEST'"
