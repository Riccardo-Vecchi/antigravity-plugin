#!/usr/bin/env bash
set -euo pipefail
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
target_dir="$HOME/.local/share/antigravity-plugin"
unit_dir="$HOME/.config/systemd/user"
node_bin="$(command -v node)"
payload="$("$node_bin" - "$source_dir" <<'JS'
const fs=require('node:fs'),path=require('node:path');
if(!globalThis.WebSocket)throw Error('Node.js 22+ is required.');
const root=process.argv[2],manifest=require(path.join(root,'common/distribution.json'));
if(manifest.version!==1)throw Error('Unsupported distribution manifest.');
const files=[...manifest.common,...manifest.linux];
for(const file of files){
 if(typeof file!=='string'||path.posix.isAbsolute(file)||file.includes('\\')||file.split('/').some(part=>!part||part==='.'||part==='..')||!fs.lstatSync(path.join(root,file)).isFile())throw Error('Invalid distribution file.');
}
const targets=new Set();
console.log([...new Set(files)].map(file=>{const mapping=Object.entries(manifest.mappings||{}).find(([prefix])=>file.startsWith(prefix));const target=mapping?mapping[1]+file.slice(mapping[0].length):file;if(path.posix.isAbsolute(target)||target.includes('\\')||target.split('/').some(p=>!p||p==='.'||p==='..')||targets.has(target))throw Error('Invalid deployment target.');targets.add(target);return file+'\t'+target;}).join('\n'));
JS
)"
"$node_bin" "$source_dir/common/migration.cjs" --prepare
install -d -m 700 "$target_dir"
while IFS=$'\t' read -r file destination; do
  install -d -m 700 "$(dirname -- "$target_dir/$destination")"
  mode=600
  case "$file" in *.sh) mode=700 ;; esac
  install -m "$mode" "$source_dir/$file" "$target_dir/$destination"
done <<< "$payload"
"$node_bin" "$target_dir/common/plugin-update-cli.cjs" receipt "$target_dir"
install -d -m 755 "$unit_dir"
if [[ ! -f "$unit_dir/antigravity-plugin.service" ]]; then
cat > "$unit_dir/antigravity-plugin.service" <<UNIT
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
fi
systemctl --user daemon-reload
systemctl --user enable antigravity-plugin.service
if systemctl --user is-active --quiet antigravity-plugin.service; then
  "$node_bin" "$source_dir/common/prepare-reload.cjs"
fi
systemctl --user restart antigravity-plugin.service
"$node_bin" "$source_dir/common/migration.cjs" --finish
"$node_bin" "$source_dir/common/prepare-reload.cjs" --restore
systemctl --user --no-pager --full status antigravity-plugin.service
