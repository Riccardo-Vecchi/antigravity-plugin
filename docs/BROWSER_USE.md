# 🌐 Browser use

Browser use connects **the native Antigravity agent** to tabs you share individually or through **All tabs in this profile** in an existing Chromium browser profile. It uses a Manifest V3 extension and Native Messaging, rather than restarting your browser with a debugging port. Existing logins stay in that browser.

## ⚙️ Three-step setup

Open **Settings → Browser use**. The guide detects supported installed browsers and advances as the connection becomes ready. The browser picker shows official browser icons beside each name and the selected value; it supports arrow keys, Home/End, typing, Enter and Escape. Icons are bundled locally:

1. **Connect:** choose your browser and click **Connect browser**. No tabs are shared at this stage.
2. **Add extension:** click **Copy folder and open Extensions**. On the browser page, enable **Developer mode**, choose **Load unpacked**, then paste the folder path already copied for you. This is a one-time browser requirement for unpacked extensions; the plugin does not change browser policies or restart an existing profile.
3. **Share tabs:** open **Antigravity Browser** from your browser toolbar. Choose selected tabs or all web tabs in this profile. The app confirms when shared tabs are ready and offers an example to copy into Antigravity.

Each browser profile connects separately. The extension keeps sharing controls in its main view; profile naming and the shared-tab list are collapsible. The app keeps the extension folder, recovery instructions, technical checks, refresh and repair together under **Connection details and help**. For an older connected extension, the main page shows only the reload step and **Open Extensions**; normal profile cards return after the extension reports its sharing mode. The app follows its language setting; the extension follows the browser language. Both support English, Italian, German, Spanish, French, Simplified Chinese and Japanese.

If you already loaded the extension from a folder removed by migration, use **Load unpacked** with the new folder shown in the guide; remove the broken old entry if the browser requires it. An extension already loaded from the branded folder can simply be reloaded on the Extensions page.

## 📦 Packaged extension and installation approval

Each release includes [antigravity-browser.zip](https://github.com/Riccardo-Vecchi/antigravity-plugin/releases/latest/download/antigravity-browser.zip), a reproducible Manifest V3 archive built from the distribution allowlist. It contains the extension directly at its root and is suitable for store submission or manual extraction. A ZIP is not a signed CRX and cannot be installed by clicking it. The guided local-folder method remains the recommended way to keep it paired with plugin updates.

Browser consent cannot be replaced by plugin consent. For a common direct-install experience across Chrome on Windows and Linux, the extension needs a published **Chrome Web Store listing**, which this project does not yet have. Linux also supports externally distributed signed CRX packages; managed deployments can use browser policies. Those mechanisms are not equivalent across platforms, and this plugin does not silently change browser management policies, edit protected profile preferences, restart your browser or bypass extension approval. The guide prepares Native Messaging, copies the correct folder and opens Extensions; the browser's final installation and sharing choices remain yours.

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
