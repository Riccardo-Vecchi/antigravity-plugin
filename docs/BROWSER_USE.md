# 🌐 Browser use

Browser use connects **the native Antigravity agent** to tabs you explicitly share in an existing Chromium browser profile. It uses a Manifest V3 extension and Native Messaging, rather than restarting your browser with a debugging port. Existing logins stay in that browser.

## ⚙️ Setup

1. Open **Settings → Browser use → Set up browser use**.
2. In your browser, open its Extensions page: `chrome://extensions`, `brave://extensions`, `edge://extensions`, `vivaldi://extensions` or `opera://extensions`.
3. Enable **Developer mode**, choose **Load unpacked**, and select the extension folder displayed by the plugin. Keep the folder in place.
4. Optionally pin **Antigravity Plugin Browser Bridge** to the toolbar. Open the extension, name this browser profile, then choose **Share this tab** on a normal web page.
5. Ask Antigravity to work in that shared tab. If the native agent has not refreshed its tools, start a new conversation.

Repeat extension installation for each profile you want to use. The extension popup uses the browser language; the app controls use the app language. Both support English, Italian, German, Spanish, French, Simplified Chinese and Japanese.

## 🧭 Working with tabs

The native agent can list connected profiles and shared tabs, read a page's accessibility tree, click referenced elements, type in ordinary editable fields, press navigation keys, scroll, navigate within the approved origin and capture the current viewport. The profile connection and tab identifiers make the target explicit. Stale references require a fresh snapshot. The initial semantic snapshot targets the main document; embedded cross-origin/out-of-process frames may need the desktop tools instead.

The extension does not expose arbitrary JavaScript evaluation, raw debugger commands, cookies, files, browser settings or unshared tabs as agent tools. Password inputs and private browsing are excluded. Page content and screenshots from a **shared** tab can of course contain personal information and are delivered to the native agent for the requested task.

Sharing ends when you stop it in the popup, close the tab/browser, change the tab's origin, disconnect its profile or disable Browser use. A different origin—including another subdomain or port—must be shared explicitly again. Browser access and desktop Computer use have separate controls. Disabling one does not disable the other.

## 🛠️ Connection and recovery

The page shows separate checks for enabled access, native MCP registration, native server detection, profile connection and shared tabs. **Repair browser connection** registers the host again if you installed another supported browser after initial setup. **Reconnect** in the extension retries the local connection; after explicitly disconnecting a profile, use Reconnect before sharing again.

The initial Linux targets are native desktop installations of Chrome, Chromium, Brave, Edge, Vivaldi and Opera in their standard user-data locations. The extension protocol is shared across Chromium browsers. The Linux Native Messaging and semantic MCP path was exercised in isolated Chromium and Brave profiles; this is not a claim that every browser/channel/sandbox package has been tested. Custom user-data locations need manual host registration. Snap/Flatpak browser sandboxes and managed-extension policies may block Native Messaging or unpacked extensions.

The Windows adapter registers a current-user host without administrator rights. Windows remains experimental and was **not** runtime-tested for this addition. No existing profile, account or browser policy is modified. Firefox and Safari are outside this implementation.

## 🔒 Local architecture

`browser-mcp.cjs` → authenticated private local IPC → `browser-host.cjs` → Chromium Native Messaging → extension → explicitly shared tab.

The Unix socket is user-only; Windows uses a named pipe plus a local authentication secret. There is no TCP listener, external proxy, debugging-port requirement or third-party automation service. Browser responses are transient. The plugin does not record tool calls, URLs, typed text, page content or screenshots in a local activity history.

The native integration uses the public [Chrome Native Messaging API](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger) and [Microsoft Edge Native Messaging registration](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/developer-guide/native-messaging). These are browser capabilities, not an official Antigravity extension API. The app's existing MCP configuration/provider integration remains subject to upstream compatibility.
