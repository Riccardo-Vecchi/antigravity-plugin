#!/usr/bin/env bash
set -euo pipefail
target_dir="$HOME/.local/share/antigravity-plugin"
if [[ -f "$target_dir/common/computer-use-cli.cjs" ]]; then
  node "$target_dir/common/computer-use-cli.cjs" disconnect || echo 'Computer-use lease revoked; review the native MCP configuration.' >&2
fi
systemctl --user disable --now antigravity-plugin.service
node - "$target_dir" <<'JS'
const path=require('node:path');
require(path.join(process.argv[2],'common','desktop-icon.cjs')).restoreIntegration().then(()=>console.log('Original icons restored; login autostart disabled.')).catch(e=>{console.error(e.message);process.exit(1)});
JS
# Code, preferences and icon backups remain available for a later reinstall.
