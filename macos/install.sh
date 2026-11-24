#!/usr/bin/env bash
set -euo pipefail
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
target_dir="$HOME/.local/share/antigravity-plugin"
config_dir="$HOME/Library/Application Support/antigravity-plugin"
agents_dir="$HOME/Library/LaunchAgents"
daemon_label="com.antigravity-plugin.daemon"
daemon_plist="$agents_dir/$daemon_label.plist"
custom_app="$HOME/Applications/Antigravity (customized).app"
launch_after=false
for arg in "$@"; do
  case "$arg" in
    --launch) launch_after=true ;;
  esac
done

pick_runtime() {
  if command -v node >/dev/null 2>&1; then
    local candidate
    candidate="$(command -v node)"
    if "$candidate" -e "if(!globalThis.WebSocket)process.exit(1)" 2>/dev/null; then
      echo "$candidate"
      return 0
    fi
  fi
  for candidate in \
    "${AGPA_APP_EXE:-}" \
    "${AGPA_APP_BUNDLE:+$AGPA_APP_BUNDLE/Contents/MacOS/Antigravity}" \
    "/Applications/Antigravity.app/Contents/MacOS/Antigravity" \
    "$HOME/Applications/Antigravity.app/Contents/MacOS/Antigravity"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

runtime_bin="$(pick_runtime)" || {
  echo "Antigravity.app or Node.js 22+ is required." >&2
  exit 1
}

app_info="$(ELECTRON_RUN_AS_NODE=1 "$runtime_bin" -e "
const { discover } = require(process.argv[1]);
discover().then(d => console.log(JSON.stringify(d))).catch(e => { console.error(e.message); process.exit(1); });
" "$source_dir/macos/installation.cjs")"

app_bundle="$(ELECTRON_RUN_AS_NODE=1 "$runtime_bin" -e "console.log(JSON.parse(process.argv[1]).bundle)" "$app_info")"
app_exe="$(ELECTRON_RUN_AS_NODE=1 "$runtime_bin" -e "console.log(JSON.parse(process.argv[1]).executable)" "$app_info")"

payload="$(ELECTRON_RUN_AS_NODE=1 "$runtime_bin" - "$source_dir" <<'JS'
const fs = require('node:fs'), path = require('node:path');
if (!globalThis.WebSocket) throw Error('Node.js 22+ or Antigravity runtime is required.');
const root = process.argv[2], manifest = require(path.join(root, 'common/distribution.json'));
if (manifest.version !== 1) throw Error('Unsupported distribution manifest.');
const files = [...manifest.common, ...manifest.macos];
for (const file of files) {
  if (typeof file !== 'string' || path.posix.isAbsolute(file) || file.includes('\\') || file.split('/').some(part => !part || part === '.' || part === '..') || !fs.lstatSync(path.join(root, file)).isFile())
    throw Error('Invalid distribution file: ' + file);
}
const targets = new Set();
console.log([...new Set(files)].map(file => {
  const mapping = Object.entries(manifest.mappings || {}).find(([prefix]) => file.startsWith(prefix));
  const target = mapping ? mapping[1] + file.slice(mapping[0].length) : file;
  if (path.posix.isAbsolute(target) || target.includes('\\') || target.split('/').some(p => !p || p === '.' || p === '..') || targets.has(target))
    throw Error('Invalid deployment target.');
  targets.add(target);
  return file + '\t' + target;
}).join('\n'));
JS
)"

ELECTRON_RUN_AS_NODE=1 "$runtime_bin" "$source_dir/common/migration.cjs" --prepare
launcher_sock="$(ELECTRON_RUN_AS_NODE=1 "$runtime_bin" -e "
const path = require('node:path'), crypto = require('node:crypto');
const cfg = process.argv[1];
const local = path.join(cfg, 'launcher.sock');
if (Buffer.byteLength(local) < 100) {
  console.log(local);
} else {
  console.log(path.join('/tmp', 'agpa-l-' + crypto.createHash('sha256').update(cfg).digest('hex').slice(0, 16) + '.sock'));
}
" "$config_dir")"
if [[ -f "$target_dir/macos/launcher.cjs" || -S "$config_dir/launcher.sock" || -S "$launcher_sock" ]]; then
  ELECTRON_RUN_AS_NODE=1 "$runtime_bin" "$source_dir/common/prepare-reload.cjs" || true
  ELECTRON_RUN_AS_NODE=1 "$runtime_bin" "$source_dir/macos/launcher.cjs" --stop || true
fi

install -d -m 700 "$target_dir" "$config_dir"
while IFS=$'\t' read -r file destination; do
  install -d -m 700 "$(dirname -- "$target_dir/$destination")"
  mode=600
  case "$file" in *.sh) mode=700 ;; esac
  install -m "$mode" "$source_dir/$file" "$target_dir/$destination"
done <<< "$payload"

ELECTRON_RUN_AS_NODE=1 "$runtime_bin" -e "
const fs = require('node:fs'), path = require('node:path');
const file = path.join(process.argv[1], 'installation.json');
const tmp = file + '.' + process.pid + '.tmp';
fs.writeFileSync(tmp, JSON.stringify({ version: 1, appBundle: process.argv[2], appExe: process.argv[3], nativeIconsSupported: true }, null, 2) + '\n', { mode: 0o600 });
fs.renameSync(tmp, file);
" "$config_dir" "$app_bundle" "$app_exe"

ELECTRON_RUN_AS_NODE=1 "$runtime_bin" "$target_dir/common/plugin-update-cli.cjs" receipt "$target_dir"

install -d -m 755 "$custom_app/Contents/MacOS" "$custom_app/Contents/Resources"
if [[ -f "$app_bundle/Contents/Resources/icon.icns" ]]; then
  install -m 644 "$app_bundle/Contents/Resources/icon.icns" "$custom_app/Contents/Resources/icon.icns"
fi
cat > "$custom_app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>Antigravity (customized)</string>
  <key>CFBundleExecutable</key>
  <string>Antigravity</string>
  <key>CFBundleIconFile</key>
  <string>icon.icns</string>
  <key>CFBundleIdentifier</key>
  <string>com.antigravity-plugin.launcher</string>
  <key>CFBundleName</key>
  <string>Antigravity (customized)</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
PLIST

ELECTRON_RUN_AS_NODE=1 "$runtime_bin" -e "
const fs = require('node:fs'), path = require('node:path');
const q = (s) => \"'\" + String(s).replace(/'/g, \"'\\\\''\") + \"'\";
const script = [
  '#!/usr/bin/env bash',
  'set -euo pipefail',
  'export ELECTRON_RUN_AS_NODE=1',
  'exec ' + q(process.argv[2]) + ' ' + q(path.join(process.argv[3], 'macos', 'launcher.cjs')) + ' --launch',
  '',
].join('\n');
fs.writeFileSync(process.argv[1], script, { mode: 0o755 });
" "$custom_app/Contents/MacOS/Antigravity" "$runtime_bin" "$target_dir"

install -d -m 755 "$agents_dir"
ELECTRON_RUN_AS_NODE=1 "$runtime_bin" -e "
const fs = require('node:fs'), path = require('node:path');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const plist = [
  '<?xml version=\"1.0\" encoding=\"UTF-8\"?>',
  '<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">',
  '<plist version=\"1.0\">',
  '<dict>',
  '  <key>Label</key>',
  '  <string>' + esc(process.argv[2]) + '</string>',
  '  <key>ProgramArguments</key>',
  '  <array>',
  '    <string>' + esc(process.argv[3]) + '</string>',
  '    <string>' + esc(path.join(process.argv[4], 'macos', 'launcher.cjs')) + '</string>',
  '    <string>--watch</string>',
  '  </array>',
  '  <key>EnvironmentVariables</key>',
  '  <dict>',
  '    <key>ELECTRON_RUN_AS_NODE</key>',
  '    <string>1</string>',
  '  </dict>',
  '  <key>RunAtLoad</key>',
  '  <true/>',
  '  <key>KeepAlive</key>',
  '  <dict>',
  '    <key>SuccessfulExit</key>',
  '    <false/>',
  '  </dict>',
  '</dict>',
  '</plist>',
  '',
].join('\n');
fs.writeFileSync(process.argv[1], plist, { mode: 0o644 });
" "$daemon_plist" "$daemon_label" "$runtime_bin" "$target_dir"

uid_num="$(id -u)"
launchctl bootout "gui/$uid_num/$daemon_label" 2>/dev/null || true
launchctl bootstrap "gui/$uid_num" "$daemon_plist"

ELECTRON_RUN_AS_NODE=1 "$runtime_bin" "$target_dir/common/migration.cjs" --finish
ELECTRON_RUN_AS_NODE=1 "$runtime_bin" "$target_dir/common/prepare-reload.cjs" --restore || true

if [[ "$launch_after" == "true" ]]; then
  ELECTRON_RUN_AS_NODE=1 "$runtime_bin" "$target_dir/macos/launcher.cjs" --launch
fi

echo "Installed Antigravity Plugin to $target_dir"
echo "Open '$custom_app' to launch Antigravity with plugin customizations."
