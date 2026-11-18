#!/usr/bin/env bash
# Run a nested GNOME Shell with its own bus, dconf and data dirs so a crash
# cannot end the real session and nothing touches the real user's settings or SSH config.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="$REPO/scratchpad/nested"
UUID="dev-hop@zarrx"
SCHEMAS="$REPO/extension/schemas"
SSH_DIR="$STATE/ssh"
SSH_CONFIG="$SSH_DIR/config"

export XDG_DATA_HOME="$STATE/data"
export XDG_CONFIG_HOME="$STATE/config"
export XDG_CACHE_HOME="$STATE/cache"
export STATE

mkdir -p "$XDG_DATA_HOME/gnome-shell/extensions" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"

glib-compile-schemas --strict "$SCHEMAS"

DEST="$XDG_DATA_HOME/gnome-shell/extensions/$UUID"
rm -rf "$DEST"
cp -r "$REPO/extension" "$DEST"

# The extension and the prefs window must never touch the real ~/.ssh/config. Keep a private
# test copy (made once from the real file, or empty) and point the setting at it on every start.
mkdir -p "$SSH_DIR"
chmod 700 "$SSH_DIR"
if [ ! -f "$SSH_CONFIG" ]; then
    if [ -f "$HOME/.ssh/config" ]; then
        cp "$HOME/.ssh/config" "$SSH_CONFIG"
    else
        : >"$SSH_CONFIG"
    fi
fi
chmod 600 "$SSH_CONFIG"
echo "dev-hop nested: ssh test copy is $SSH_CONFIG (the real ~/.ssh/config is not used)"

# Note: actions launched from the nested shell inherit these isolated XDG folders, so a tool that
# updates itself (for example a CLI auto-updater) may write into scratchpad/nested and repoint
# links in ~/.local/bin. Avoid running self-updating tools from here, or check their links after.

# dconf is the settings backend for both the shell and the prefs window. The prefs process is
# D-Bus activated, so it only sees what is in the bus activation environment: XDG_* is put
# there below so dconf-service and the prefs window use the isolated dirs, not the real ones.
exec dbus-run-session -- bash -c '
set -euo pipefail
export XDG_DATA_HOME="'"$XDG_DATA_HOME"'"
export XDG_CONFIG_HOME="'"$XDG_CONFIG_HOME"'"
export XDG_CACHE_HOME="'"$XDG_CACHE_HOME"'"
# D-Bus activated apps take their env from the bus, not the shell. Point them at the
# nested display, run without Xwayland so no app can land on the real desktop, and give them
# the isolated XDG dirs.
dbus-update-activation-environment XDG_DATA_HOME XDG_CONFIG_HOME XDG_CACHE_HOME \
    WAYLAND_DISPLAY=dev-hop-0 DISPLAY= GDK_BACKEND=wayland
# Settings are written inside this bus session, so they land in the isolated dconf.
gsettings set org.gnome.shell enabled-extensions "['"'"'dev-hop@zarrx'"'"']"
gsettings set org.gnome.shell disable-user-extensions false
gsettings --schemadir "'"$SCHEMAS"'" set org.gnome.shell.extensions.dev-hop ssh-config-path "'"$SSH_CONFIG"'"
MUTTER_DEBUG_DUMMY_MODE_SPECS=1920x1080 gnome-shell --nested --wayland --no-x11 --wayland-display=dev-hop-0 2>&1 | tee "$STATE/shell.log"
'
