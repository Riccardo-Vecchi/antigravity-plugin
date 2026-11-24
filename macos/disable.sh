#!/usr/bin/env bash
set -euo pipefail
target_dir="$HOME/.local/share/antigravity-plugin"
agents_dir="$HOME/Library/LaunchAgents"
daemon_label="com.antigravity-plugin.daemon"
autostart_label="com.antigravity-plugin.autostart"
custom_app="$HOME/Applications/Antigravity (customized).app"
uid_num="$(id -u)"

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

if runtime_bin="$(pick_runtime)"; then
  if [[ -f "$target_dir/common/computer-use-cli.cjs" ]]; then
    ELECTRON_RUN_AS_NODE=1 "$runtime_bin" "$target_dir/common/computer-use-cli.cjs" disconnect || echo 'Computer-use lease revoked; review native MCP settings.' >&2
  fi
  if [[ -f "$target_dir/macos/desktop.cjs" ]]; then
    ELECTRON_RUN_AS_NODE=1 "$runtime_bin" -e "require(process.argv[1]).restoreIntegration().catch(()=>{})" "$target_dir/macos/desktop.cjs" || true
  fi
  if [[ -f "$target_dir/macos/launcher.cjs" ]]; then
    ELECTRON_RUN_AS_NODE=1 "$runtime_bin" "$target_dir/macos/launcher.cjs" --stop || true
  fi
fi

launchctl bootout "gui/$uid_num/$daemon_label" 2>/dev/null || true
launchctl bootout "gui/$uid_num/$autostart_label" 2>/dev/null || true
rm -f "$agents_dir/$daemon_label.plist" "$agents_dir/$autostart_label.plist"
rm -rf "$custom_app"

echo "Antigravity Plugin has been stopped and macOS launcher integrations removed."
