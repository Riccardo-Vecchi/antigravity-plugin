# 🌐 Browser use

Browser use connects **the native Antigravity agent** to tabs you share individually or through **All tabs in this profile** in an existing Chromium browser profile. It uses a Manifest V3 extension and Native Messaging, rather than restarting your browser with a debugging port. Existing logins stay in that browser.

## ⚙️ Three-step setup

Open **Settings → Browser use**. The guide detects supported installed browsers and checks only Antigravity Browser’s own installation record in standard local profiles. An installed but disconnected extension goes to reconnect instructions; disabled, outdated and missing-folder entries get recovery instructions instead of a generic reinstallation prompt. A live connection remains the proof that browser tools are available. The browser picker shows official browser icons beside each name and the selected value; it supports arrow keys, Home/End, typing, Enter and Escape. Icons are bundled locally:

1. **Connect:** choose your browser and click **Connect browser**. No tabs are shared at this stage.
2. **Add extension:** click **Copy folder and open Extensions**. If Antigravity Browser is already listed, enable or reload it instead of adding another copy. Otherwise enable **Developer mode** and choose **Load unpacked**. In the browser’s folder-selection window, use **Ctrl+L** on Linux or **Alt+D** on Windows to focus the address/location bar, paste with **Ctrl+V**, then confirm the folder. This is a one-time browser requirement for unpacked extensions; the plugin does not change browser policies or restart an existing profile.
3. **Share tabs:** open **Antigravity Browser** from your browser toolbar. Choose selected tabs or all web tabs in this profile. The app confirms when shared tabs are ready and offers an example to copy into Antigravity.

When an installed copy is detected, **Open installed extension** opens its details in a standard browser profile containing that copy. The plugin never enables an extension or grants tab access on your behalf. Detection is best-effort: custom user-data directories, unreadable/protected metadata or nonstandard sandbox locations can require a manual check. Only this extension’s ID, installation state and manifest are inspected; profile names, accounts, cookies, history and tabs are not collected.

Each browser profile connects separately. The extension keeps sharing controls in its main view; profile naming and the shared-tab list are collapsible. The app keeps the extension folder, recovery instructions, technical checks, refresh and repair together under **Connection details and help**. **Refresh status** is always visible in the main actions and rescans the connection without reloading the extension or stopping sharing. Missing sharing-mode metadata from an older connected extension does not block working tabs. Under **Connection details and help**, **Open Extensions page** opens the browser’s extension list: enable **Developer mode** in the top right to reveal the Reload icon on the **Antigravity Browser** card. That Reload is separate from Refresh status and stops sharing until tabs are chosen again. The app follows its language setting; the extension follows the browser language. Both support English, Italian, German, Spanish, French, Simplified Chinese and Japanese.

If you already loaded the extension from a folder removed by migration, use **Load unpacked** with the new folder shown in the guide; remove the broken old entry if the browser requires it. An extension already loaded from the branded folder can simply be reloaded on the Extensions page.

## 📦 Packaged extension and installation approval

Each release includes [antigravity-browser.zip](https://github.com/Riccardo-Vecchi/antigravity-plugin/releases/latest/download/antigravity-browser.zip), a reproducible Manifest V3 archive built from the distribution allowlist. It contains the extension directly at its root and is suitable for store submission or manual extraction. A ZIP is not a signed CRX and cannot be installed by clicking it. The guided local-folder method remains the recommended way to keep it paired with plugin updates.

Browser consent cannot be replaced by plugin consent. For a common direct-install experience across Chrome on Windows and Linux, the extension needs a published **Chrome Web Store listing**, which this project does not yet have. Linux also supports externally distributed CRX packages; Brave’s official documentation also describes dragging a CRX onto its Extensions page with Developer mode enabled. A stable CRX requires the matching private signing key and an update/distribution plan; the repository’s public manifest key alone cannot sign one. Store submission remains the simplest common installation route. See [Chrome Linux packaging](https://developer.chrome.com/docs/extensions/how-to/distribute/host-on-linux) and [Brave’s extension guidance](https://support.brave.app/hc/en-us/articles/360017914832-Why-am-I-seeing-the-message-extensions-disabled-by-Brave). Managed deployments can use browser policies; those mechanisms are not equivalent across platforms, and this plugin does not silently change browser management policies, edit protected profile preferences, restart your browser or bypass extension approval. The guide prepares Native Messaging, copies the correct folder and opens Extensions; the browser's final installation and sharing choices remain yours.

Distribution rules: [Chrome extension distribution](https://developer.chrome.com/docs/extensions/how-to/distribute), [alternative installation methods](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions), and [Microsoft Edge distribution](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/alternate-distribution-options).

To build the archive locally (Python 3 is a development/release tool, not a new Windows runtime requirement):

```sh
python3 scripts/package-browser-extension.py output/antigravity-browser.zip
```

## 🧭 Working with tabs

The native agent can list connected profiles and shared tabs, read a page's accessibility tree, click referenced elements, type in ordinary editable fields, press navigation keys, scroll, navigate within the approved origin (or across regular web sites in whole-profile mode) and capture the current viewport. The profile connection and tab identifiers make the target explicit. Stale references require a fresh snapshot. The initial semantic snapshot targets the main document; embedded cross-origin/out-of-process frames may need the desktop tools instead.

The extension does not expose arbitrary JavaScript evaluation, raw debugger commands, cookies, files, browser settings or unshared tabs as agent tools. Password inputs and private browsing are excluded. Page content and screenshots from a **shared** tab can of course contain personal information and are delivered to the native agent for the requested task.

Sharing ends when you stop it in the popup, close the tab/browser, disconnect its profile or disable Browser use. In Selected tabs mode, a different origin—including another subdomain or port—must be shared explicitly again. In **All tabs in this profile** mode, current and newly opened regular HTTP(S) tabs are included across sites. Password fields, private browsing and internal browser pages remain excluded. Stop an individual tab to exclude it until you select the mode again. Stop sharing, disconnecting, cancelling the browser debugger banner or restarting the extension resets sharing to Selected tabs; the browser permission alone never reactivates it. Browser access and desktop Computer use have separate controls. Disabling one does not disable the other.

## 🛠️ Connection and recovery

The page shows separate checks for enabled access, native MCP registration, native server detection, profile connection and shared tabs. **Repair browser connection**, under Connection details and help, registers the host again if you installed another supported browser after initial setup. **Reconnect** in the extension retries the local connection; after explicitly disconnecting a profile, use Reconnect before sharing again.

The initial Linux targets are native desktop installations of Chrome, Chromium, Brave, Edge, Vivaldi and Opera in their standard user-data locations. The extension protocol is shared across Chromium browsers. The Linux Native Messaging and semantic MCP path was exercised in isolated Chromium and Brave profiles; this is not a claim that every browser/channel/sandbox package has been tested. Custom user-data locations need manual host registration. Snap/Flatpak browser sandboxes and managed-extension policies may block Native Messaging or unpacked extensions.

The Windows adapter registers a current-user host without administrator rights. Windows remains experimental and was **not** runtime-tested for this addition. No existing profile, account or browser policy is modified. Firefox and Safari are outside this implementation.

## 🔒 Local architecture

`browser-mcp.cjs` → authenticated private local IPC → `browser-host.cjs` → Chromium Native Messaging → extension → explicitly shared tab.

The Unix socket is user-only; Windows uses a named pipe plus a local authentication secret. There is no TCP listener, external proxy, debugging-port requirement or third-party automation service. Browser responses are transient. The plugin does not record tool calls, URLs, typed text, page content or screenshots in a local activity history.

The native integration uses the public [Chrome Native Messaging API](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger) and [Microsoft Edge Native Messaging registration](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/developer-guide/native-messaging). These are browser capabilities, not an official Antigravity extension API. The app's existing MCP configuration/provider integration remains subject to upstream compatibility.

## 📁 Extension folder and updates

The extension is published under `~/.local/share/antigravity-plugin/browser-extension` on Linux and `%LOCALAPPDATA%\antigravity-plugin\browser-extension` on Windows. Code and the extension share the `antigravity-plugin` installation root; preferences and the computer-use runtime use the standard `antigravity-plugin` configuration root. The setup page shows the correct folder to load. The previous `antigravity-project-appearance` roots are removed after verified migration; reload an old unpacked-extension entry from the new folder when needed. Its extension ID remains unchanged. After a plugin update, click Reload for **Antigravity Browser** on your browser’s Extensions page to apply the new extension code and icon.

Other Chromium-based browsers can use the same extension if they support Native Messaging and the debugger API; nonstandard browser/profile locations may need manual Native Messaging host registration. Sandbox or managed policies can prevent this.
