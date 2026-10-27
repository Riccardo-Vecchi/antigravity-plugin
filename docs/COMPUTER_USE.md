# 🖱️ Computer use

Give the **native Antigravity agent** desktop tools through the maintained [Cua Driver](https://github.com/trycua/cua/tree/main/libs/cua-driver). The agent uses its existing model; the driver needs no separate model API key. The embedded Gemini website remains a separate web session and does not receive these tools.

## 🧭 Get started

1. Open **Settings → Computer use**, its own item in the Settings menu. Settings navigation has icons; its Projects group can be collapsed and uses your configured project appearance.
2. Choose **Entire desktop** to work across your environment, or **Selected apps** for an application allowlist.
3. Select **Enable computer use**. Setup downloads the reviewed driver, verifies its SHA-256, installs the GNOME helper when needed, writes this integration's MCP entry and skill, checks the protocol and asks Antigravity to refresh only this server.
4. Follow any OS access prompt. On GNOME/Wayland, the helper needs a **Linux session logout/login once** to load. Save your work, open the system menu → Power → Log Out (on Zorin), then sign in to Linux again. Reopen Antigravity and select **Refresh status**. **Locking/unlocking the screen keeps the same Linux session and does not load the extension.** Closing the app or signing out of Google also does not load it. The wizard never logs you out or restarts your apps.
5. Start a **new Antigravity conversation** and describe the result you want. Existing conversations can keep their earlier tool list.

Try: “Open Calculator, calculate 6 × 7 and verify the displayed result.” The agent should observe **42 in the app**, rather than report only a successful tool call.

**Connection details** displays each check on its own line: green checkmark for passed, orange dot for pending. It checks driver installation, MCP registration, the generated agent skill, the protocol handshake, native server detection and the desktop helper. In Entire desktop mode, **Test screen capture** separately checks whether the driver can read the screen. It captures once, discards the image and returns only the result; it does not test mouse or keyboard input. An MCP handshake alone never marks screen capture as passed.

If an upstream app change prevents automatic MCP refresh, use native **Customizations → Installed → MCP Servers**, or its Settings equivalent, and refresh/reopen Antigravity when convenient.

![Computer use: desktop access and Linux activation instructions](images/computer-use.png)

![Connection checks with individual passed and pending states](images/computer-use-checks.png)

## 🖥️ Choose the access that fits

| Mode | Access |
| --- | --- |
| **Entire desktop** | App/window discovery, full-desktop and window observations, mouse movement, click, drag, keyboard and application launch. The driver runs in its normal **standard** permission mode, with its normal protected-target and grant checks. |
| **Selected apps** | Only chosen executable paths and their windows/launch actions. Uses the driver's **bounded** mode with a capability manifest; general app enumeration and full-desktop capture are excluded. The detected-app selector helps add common applications; manual absolute paths remain available. |

Changing scope requires **Apply access changes**. It revokes earlier connections before starting the new scope. Choosing Entire desktop is not an `unrestricted`/bypass-approvals setting. Existing Antigravity approvals remain in force.

In either mode, the bridge exposes only the reviewed GUI tool set (17 tools for Entire desktop and 14 for Selected apps in driver 0.37.0). It excludes direct shell execution, arbitrary scripts, filesystem tools, process termination and browser-profile attachment. GUI interaction can still modify files, accounts and signed-in applications as part of a task; visible contents may be processed by Antigravity's model. These controls limit this driver, not Antigravity's independent shell access or another process running as your user.

## ⏹️ Stop and disconnect

**Stop and disconnect** is always available during setup or while connected. It cancels setup, revokes the lease and removes only the plugin's MCP entry, preserving unrelated servers. The bridge checks revocation every 300 ms, requests graceful shutdown and forces exit if needed. An action already delivered cannot be undone. Driver files, scope choices and the owned skill remain available for reconnecting.

The platform disable scripts also disconnect computer use. In Selected apps mode, capability sessions expire after eight hours, with a thirty-minute idle timeout; reconnect to start a fresh runtime. Entire desktop uses the normal driver session lifecycle.

## ♻️ Remove and set up again

Open **Settings → Computer use → Connection details → Remove computer use…** and confirm in the centered dialog. Cancel or press Escape to keep the setup. This revokes the connection, removes only the plugin's own MCP entry, deletes its verified managed driver, setup preferences and unchanged generated skill. Then choose **Enable computer use** to download and configure it again.

Other MCP servers, conversations, Antigravity/Gemini data, other Cua installations and the **shared WinRects GNOME extension** remain untouched. A locally edited skill is preserved and reported: rename or remove it yourself before a fresh setup. Unrecognized driver folders or missing/invalid receipts stop removal instead of deleting unknown files. Use **Repair desktop helper** for a disabled or failed helper; reinstallation is unnecessary when it only needs the next Linux sign-in.

## 🐧 Linux

The wizard installs the official x86-64 or ARM64 driver asset. An active graphical session and AT-SPI are required; distro dependencies can include `at-spi2-core` and `libxi6`. It does not run `sudo`, change your PATH or install deprecated `cua-agent` or perception/model packages.

GNOME/Mutter Wayland uses the bundled WinRects Shell helper and can require portal consent. Its installer preserves newer shared helper versions and other enabled extensions. Until GNOME loads the helper, the page shows a compact **Desktop access needs activation** notice with explicit Linux logout/login steps. Installed files and an extension actively loaded by GNOME are checked separately. X11, GNOME, KDE and other compositors have different support: background input and occluded windows remain limited. See [upstream platform support](https://cua.ai/docs/cua-driver/concepts/platform-support).

A successful MCP handshake checks the protocol and available tools. It does **not** prove that the OS permits capture/input or that an application task succeeded. The page keeps that distinction visible.

## <img src="../assets/logos/windows.svg" width="20" alt="Windows"> Windows (experimental)

The same wizard uses the official Windows x64 ZIP and Antigravity's bundled runtime; no separate Node.js, Python, administrator access or scheduled driver task is required. Extraction includes the driver's UI Automation helper. Launch through **Antigravity (customized)** in the interactive desktop session and keep the target app visible. Elevated apps can refuse input.

Windows is covered by adapter/configuration tests, release archive-layout verification and PowerShell syntax checks. A full Windows GUI task has not been verified for this integration.

## 🔧 Installation, privacy and compatibility

- Reviewed driver: **0.37.0**, pinned to official release asset SHA-256 values. Future plugin releases can update the reviewed pin; setup never silently adopts an unreviewed driver.
- Downloads run no remote installer script. The driver is a separate MIT-licensed upstream dependency, not relicensed under the plugin's 0BSD license. No driver binaries or private configuration are published here. SHA-256 pin verification is not a claim of Sigstore signature verification.
- Plugin-launched driver calls disable telemetry with `CUA_DRIVER_RS_TELEMETRY_ENABLED=0` and `CUA_TELEMETRY_ENABLED=0`. Other Cua installations are unchanged.
- Local files live under the existing plugin configuration directory in `computer-use/`: `state.json`, `capabilities.json`, and `driver-0.37.0/`. They can contain local application paths and must not be shared or committed.
- The wizard merges `~/.gemini/config/mcp_config.json` and installs its owned skill under `~/.gemini/config/skills/antigravity-plugin-computer-use/` (under the user's home on Windows too). Unrelated MCP entries and locally edited skills are preserved. Invalid JSON, symlinks, conflicts or detected concurrent edits stop configuration.
- Automatic native MCP refresh uses a narrowly recognized Antigravity state-provider contract. It refreshes only this server and falls back to manual native refresh if the interface changes.

## ✅ Validation boundaries

Verified live on Linux: the dedicated Settings page, navigation icons, Projects collapse, scoped/full-desktop configuration, native Antigravity discovery of the reviewed tool set, protocol checks, disconnection, confirmed removal and fresh reinstallation. On GNOME/Wayland, the installed helper still requires the next desktop sign-in; a complete desktop calculation has not been verified in that session. An Xvfb test without a window manager did not establish GUI readiness. Windows remains experimental as described above.

## 📚 References

- [Google Antigravity MCP](https://antigravity.google/docs/mcp)
- [Cua with Antigravity and Gemini](https://cua.ai/docs/cua-driver/guides/gemini)
- [Cua permissions](https://cua.ai/docs/cua-driver/guides/permissions)
- [Cua Driver 0.37.0](https://github.com/trycua/cua/releases/tag/cua-driver-rs-v0.37.0)
