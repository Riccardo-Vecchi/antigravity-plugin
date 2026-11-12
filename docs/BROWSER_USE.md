# 🌐 Browser use

Use your Chromium browser and existing logins with the official Chrome DevTools MCP tools. No extension or manual package installation is required.

## 🔌 Connect

1. Open **Settings → Browser use** and enable it.
2. Choose your browser. On Windows, copy the address shown in Settings, paste it into your browser’s address bar, and open **Remote debugging**. On Linux, click **Connect browser** to open the browser’s settings page.
3. Enable **Allow remote debugging**. On Windows, return to Antigravity and click **Connect browser** once the button appears. Approve the browser’s connection prompt. With multiple profiles, windows or installed web apps (PWAs), the request may appear in another window; check each of them. Settings updates automatically.

Once connected, ask Antigravity to use your connected browser. It can navigate, click, fill forms, inspect page structure, take screenshots and investigate console/network issues using the upstream tools. Browser authorization applies to the connected instance rather than separately shared tabs.

The first connection can take longer while the official component initializes existing tabs; a moving indicator remains visible. If the prompt is dismissed, click **Connect browser** again. If no permission setting appears, update the browser; Chromium variants differ in their remote-debugging support. Custom profile locations are not currently auto-discovered. The plugin never restarts your browser, changes its preferences, copies your profile or exposes a debugging listener on your behalf.

Chrome and Edge on Windows can launch or switch profiles without opening a browser-internal URL passed by an external app. The copy-and-paste step opens the page in the browser window you choose.

## ⚙️ Controls

- **Browser:** changes the connection target and closes the previous tool session.
- **Enabled/Disabled:** closes the tool process and removes its MCP entry when disabled. Only the enable switch remains visible.

The selected browser is remembered locally. Existing remote-debugging permission is reused when the browser allows it; the browser may request connection approval again. Antigravity’s ordinary MCP tool permissions still apply. Tools are available to the native Antigravity agent, not the embedded Gemini website.

### Browser control indicator

The “controlled by automated test software” banner belongs to the browser and cannot be renamed by the plugin. The agent receives a **release_browser** tool to release control after its task; as a fallback the plugin disconnects after **60 seconds without browser operations**, including after a connection check. Running operations are allowed to finish. Settings refreshes and tool discovery do not keep control alive or reconnect automatically. Windows and tabs stay open. A later browser task reconnects on demand and may require another browser approval. **Ready when needed** means setup passed but control is currently released. If the browser still shows a banner after all debugging clients disconnect, it may be a stale browser indicator. Turn off **Allow remote debugging** on the browser’s remote-debugging settings page to reset it, then enable it again before the next browser task. Do not use browser automation flags to hide the indicator.

## 🧩 Compatibility

The plugin uses the official `chrome-devtools-mcp` release without a fork. The current stable pin is **1.12.0**. When Antigravity bundles an older version, Connect prepares this pinned upstream package automatically under the plugin’s configuration directory, checking its SHA-512 integrity before extracting it. No npm command, extension or copied browser profile is needed. A sufficiently recent bundled version is reused. Chrome and Chrome for Testing are its officially supported targets; Brave, Edge, Chromium, Vivaldi and Opera are offered when installed and can work through the same DevTools protocol. Compatibility with each variant is conditional on its implementation. The full new transport has been tested locally with Brave on Linux; Windows uses the shared engine and platform-specific executable/profile discovery and has not been exercised live for this change.

The native **/browser** command still uses Antigravity’s own browser selection. This integration supplies official DevTools tools through an additional MCP registration; it does not claim to redirect the native command.

## 🧹 Previous extension

The plugin no longer deploys or uses Antigravity Browser. Existing installations can remove that extension from their browser’s Extensions page. Browser profiles, logins and browsing data are preserved.

## 📚 Upstream

- [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp)
- [Browser connection options](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md)
- [Native Antigravity browser command](https://antigravity.google/docs/commands/browser)
