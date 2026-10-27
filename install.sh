#!/usr/bin/env bash
set -euo pipefail
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
target_dir="$HOME/.local/share/antigravity-project-appearance"
unit_dir="$HOME/.config/systemd/user"
node_bin="$(command -v node)"
"$node_bin" -e 'if(!globalThis.WebSocket) process.exit(1)'
install -d -m 700 "$target_dir"
install -m 600 "$source_dir/renderer.js" "$target_dir/renderer.js"
install -m 600 "$source_dir/daemon.cjs" "$target_dir/daemon.cjs"
install -m 600 "$source_dir/versions.cjs" "$target_dir/versions.cjs"
install -m 600 "$source_dir/session-state.cjs" "$target_dir/session-state.cjs"
install -m 600 "$source_dir/compatibility.cjs" "$target_dir/compatibility.cjs"
install -m 600 "$source_dir/shortcuts.js" "$target_dir/shortcuts.js"
install -m 600 "$source_dir/gemini-switch.css" "$target_dir/gemini-switch.css"
install -m 600 "$source_dir/gemini-switch.js" "$target_dir/gemini-switch.js"
install -m 600 "$source_dir/gemini-inline.js" "$target_dir/gemini-inline.js"
install -m 600 "$source_dir/app-settings.js" "$target_dir/app-settings.js"
install -m 600 "$source_dir/i18n.js" "$target_dir/i18n.js"
install -m 600 "$source_dir/locales.json" "$target_dir/locales.json"
install -m 600 "$source_dir/window-chrome.css" "$target_dir/window-chrome.css"
install -m 600 "$source_dir/desktop-icon.cjs" "$target_dir/desktop-icon.cjs"
install -m 600 "$source_dir/desktop-linux.cjs" "$target_dir/desktop-linux.cjs"
install -m 600 "$source_dir/app-preferences.cjs" "$target_dir/app-preferences.cjs"
install -m 600 "$source_dir/platform-paths.cjs" "$target_dir/platform-paths.cjs"
install -m 600 "$source_dir/refresh-icon-theme.py" "$target_dir/refresh-icon-theme.py"
install -m 600 "$source_dir/sync-tray-icon.py" "$target_dir/sync-tray-icon.py"
install -m 600 "$source_dir/prepare-reload.cjs" "$target_dir/prepare-reload.cjs"
install -d -m 700 "$target_dir/icons"
install -m 600 "$source_dir/icons/antigravity.png" "$target_dir/icons/antigravity.png"
install -m 600 "$source_dir/icons/gemini.png" "$target_dir/icons/gemini.png"
for size in 16 24 32 48 64 128 256 512; do
  install -m 600 "$source_dir/icons/gemini-$size.png" "$target_dir/icons/gemini-$size.png"
done
install -m 600 "$source_dir/switch-assets.json" "$target_dir/switch-assets.json"
install -d -m 755 "$unit_dir"
cat > "$unit_dir/antigravity-project-appearance.service" <<UNIT
[Unit]
Description=Local icons and colors for Antigravity projects

[Service]
Type=simple
ExecStart=$node_bin $target_dir/daemon.cjs
WorkingDirectory=$target_dir
Restart=on-failure
RestartSec=4
UMask=0077
NoNewPrivileges=yes
TimeoutStopSec=8

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable antigravity-project-appearance.service
if systemctl --user is-active --quiet antigravity-project-appearance.service; then
  "$node_bin" "$source_dir/prepare-reload.cjs"
fi
systemctl --user restart antigravity-project-appearance.service
"$node_bin" "$source_dir/prepare-reload.cjs" --restore
systemctl --user --no-pager --full status antigravity-project-appearance.service
