#!/usr/bin/env bash
set -euo pipefail
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
target_dir="$HOME/.local/share/antigravity-project-appearance"
unit_dir="$HOME/.config/systemd/user"
node_bin="$(command -v node)"
payload="$("$node_bin" - "$source_dir" <<'JS'
const fs=require('node:fs'),path=require('node:path');
if(!globalThis.WebSocket)throw Error('Node.js 22+ is required.');
const root=process.argv[2],manifest=require(path.join(root,'distribution.json'));
if(manifest.version!==1)throw Error('Unsupported distribution manifest.');
const files=[...manifest.common,...manifest.linux];
for(const file of files){
 if(typeof file!=='string'||path.posix.isAbsolute(file)||file.includes('\\')||file.split('/').some(part=>!part||part==='.'||part==='..')||!fs.lstatSync(path.join(root,file)).isFile())throw Error('Invalid distribution file.');
}
console.log([...new Set(files)].join('\n'));
JS
)"
install -d -m 700 "$target_dir"
while IFS= read -r file; do
  install -d -m 700 "$(dirname -- "$target_dir/$file")"
  mode=600
  case "$file" in *.sh) mode=700 ;; esac
  install -m "$mode" "$source_dir/$file" "$target_dir/$file"
done <<< "$payload"
install -d -m 755 "$unit_dir"
cat > "$unit_dir/antigravity-project-appearance.service" <<UNIT
[Unit]
Description=Local icons and colors for Antigravity projects

[Service]
Type=simple
ExecStart=$node_bin $target_dir/common/daemon.cjs
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
  "$node_bin" "$source_dir/common/prepare-reload.cjs"
fi
systemctl --user restart antigravity-project-appearance.service
"$node_bin" "$source_dir/common/prepare-reload.cjs" --restore
systemctl --user --no-pager --full status antigravity-project-appearance.service
