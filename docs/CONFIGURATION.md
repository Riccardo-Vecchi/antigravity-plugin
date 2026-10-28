# Configuration and development reference

See the [README](../README.md), [Linux guide](../linux/README.md) and [Windows guide](../windows/README.md) for installation.

## Settings

![Appearance preferences](images/preferences.png)

![Application startup preferences](images/startup.png)

![Patch status and recovery](images/integration.png)

Open **Settings → Appearance** for visual options:

- **Application icon:** fixed Antigravity, fixed Gemini, or Dynamic.

Open **Settings → Application → Startup** for launch behavior:

- **Start in:** Antigravity, Gemini, or **Remember last view**. The last view is shared across app windows and survives helper/app restarts. With no saved view, Antigravity is used.
- **Launch at desktop sign-in:** whether the desktop should launch the app after you sign in.

These choices are independent. For example, you can start in Gemini, use a fixed Antigravity icon, and keep autostart disabled.

On Linux, the helper service starting with your session does **not** itself launch Antigravity. The separate autostart checkbox creates/removes its own launcher in `~/.config/autostart/`. Desktop policy or separate startup entries created outside this project can affect autostart behavior. See the [XDG autostart specification](https://specifications.freedesktop.org/autostart/latest/).

In Dynamic mode, the taskbar and supported tray follow the last view reported by an app window. The icon is global to the app; multiple windows do not have separate taskbar identities.

Open **Settings → Shortcuts** for the configurable window-local switch between Antigravity and Gemini (default **Ctrl+Alt+G**). Choose Change shortcut, press Ctrl+Alt or Ctrl+Shift with a letter/number, then Save shortcut. Escape cancels recording; Reset shortcut restores the default, and Disable shortcut turns the binding off. Preferences update existing native and Gemini views without reloading them. System shortcuts may take priority. It does not register an operating-system-wide shortcut, and repeated keys, input-method composition, and AltGr typing are ignored. The in-page shortcut is added only on the official Gemini origin; account sign-in pages retain the visible return button.

## Model organization and approval colors

Open the native model menu and use the star beside a model to pin it. **Manage models** provides keyboard-accessible Favorite/Hidden checkboxes. Favorites appear first; **Show hidden models** restores hidden entries in the menu. The selected model and native availability/notice badges are preserved. Gemini effort groups are organized as one family; their native effort submenu stays available. Preferences live in the plugin's private `models.json`, separate from Antigravity model configuration.

Anthropic, Google and OpenAI icons identify recognized providers in the menu and selected-model button. Unknown providers keep their native presentation. Approval colors indicate Request Review (blue), Default (green), Auto (amber) and Turbo (red); they do not change native approval rules.

## Enable or pause the plugin

Use **Settings → Application → Plugin updates → Enable plugin**. Turning it off asks for confirmation, disconnects Computer use and Browser use, removes added controls and restores native icons. Preferences, conversation data, desktop startup choices and existing Gemini web contents are kept. A hidden Gemini view is parked without reloading or deleting its session/draft. A small management layer remains so the same switch can turn customizations back on, including after restarting the app. Desktop/browser access must be enabled separately; it is never silently regranted. The choice is stored in the private `plugin.json` file.

**Antigravity → Check Antigravity Updates** retains the official app's action. **Check Plugin Updates** opens the plugin's settings and checks GitHub releases immediately, even when customizations are paused. Manual plugin installation is available after re-enabling; automatic update timers stop while paused.

The platform disable scripts stop the helper entirely and have their existing platform-specific behavior. Use the GUI switch for reversible suspension with preferences retained.

## Patch status and recovery

Open **Settings → Application → Plugin updates → Plugin customizations**:

- **Version** identifies the installed helper code.
- **Check compatibility** reads the current native interface hooks and checks the project, settings, Gemini, and keyboard integrations. The result and time of the last check are shown for that window.
- **Reapply patch** restores the integration's controls and styles without navigating the native app or the Gemini guest. Project customizations and app preferences are retained.

Checks distinguish missing helper elements (repairable) from missing native hooks (incompatible). Reapplication is skipped if required native hooks changed, a project editor is open, or an existing Gemini guest lost its original controller. This preserves the current session; a changed upstream interface can require a source update followed by `./linux/install.sh`.

These are local interface checks. A Ready result does not certify every vendor feature, website request, login flow, or future app release. Reapplication repairs the running UI; it does not download updates, overwrite the AppImage, or change your desktop settings.

## Languages

The additions follow the native page's declared interface language (`<html lang>`), including changes while the app is open. If the page declares no language, Chromium's preferred language is used. Regional variants map to their base language, and unsupported languages fall back to English.

Translations cover settings, project editing, the compact sidebar, accessibility labels, tooltips, status/error messages, and the Antigravity return button in Gemini. Icon names can be searched in the selected language; stable icon IDs remain unchanged. Changing language preserves open inputs and unsaved project appearance choices. Project names, user text, and Google's website content are not translated by this helper.

The initial localization inspection on Antigravity 2.26.0 found an English interface without a native display-language selector. The current tested Linux compatibility baseline is 2.27.0. This integration does not add a separate language preference or translate the native app. Live language checks change the native document's language temporarily, then restore it; following an upstream language preference depends on the app declaring that language.

## Gemini sessions and switching

Gemini runs in an isolated persistent webview session. Returning to Antigravity keeps that guest mounted, preserving the page and unsent draft. The native app stays mounted as well.

Sign in to Google inside the embedded website on first use. Browser cookies and passwords are not imported, and native Antigravity credentials are not reused. Google controls website availability, account checks, and whether embedded sign-in is accepted. A Google prompt may need the normal **Resend** action; this project does not bypass authentication.

Only the return button is added to the Gemini page, in an isolated JavaScript world. The website does not receive Node.js, Antigravity's preload APIs, or the local settings bridge. Web security, context isolation, and sandboxing remain enabled. On Linux, no new debugging port is opened. On Windows, the customized launcher temporarily uses the existing main-process inspector capability on loopback for native icons, then closes it; see the [Windows integration details](../windows/README.md#native-window-and-tray-icons). The project relies on [Electron's existing webview support](https://www.electronjs.org/docs/latest/api/webview-tag).

## Validation

```bash
node --test tests/*.test.cjs
node --check common/daemon.cjs
bash -n linux/install.sh linux/disable.sh
python3 -m py_compile linux/refresh-icon-theme.py linux/sync-tray-icon.py
```

Automated tests cover preference migration, independent startup/icon choices, one-time/remember-last startup, session-state persistence and recovery, shortcut handling and AltGr, compatibility/recovery gates, translation coverage/placeholders, regional languages, English fallback, and updating open controls without losing input. Live checks cover switching with the shortcut from both the native page and Gemini, recovery after removing a helper stylesheet, refusing recovery when a native hook is missing, helper restarts with the last view preserved, and localized controls in all seven languages. Earlier live checks cover project appearance, compact sidebar, fixed/dynamic icons, tray, menu hiding, and XDG autostart. A full logout/login is deliberately not part of the automated checks.

Windows-specific tests additionally cover path handling, native icon requests, stale-process detection, inspector-closure reporting, existing-tray preservation, and owned-autostart rollback. See [Windows validation](../windows/README.md#validation-status) for actual VM coverage and remaining boundaries.

This repository contains the integration source and generic tests, not personal diagnostics, account information, cookies, conversations, or feedback submission receipts.

## Branding and attribution

See [NOTICE.md](../NOTICE.md) and [asset sources](../assets/SOURCES.md). Google owns the Antigravity and Gemini branding. No rights in Google logos or the proprietary application are granted by this repository.

## Source layout

- `common/`: shared renderer, settings, localization, preferences and runtime.
- `linux/`: GNOME/tray integration and Linux installer/disable scripts.
- `windows/`: native icon attachment, launcher, autostart and PowerShell scripts.
- `tests/`: shared and platform-adapter fixtures; `common/distribution.json` defines deployment payloads.

Installation commands live in their platform folders. Owned Windows shortcuts from older installations are migrated, while deployed icon paths remain stable. Configuration directories, the service name and icon/backup paths retain their existing names so upgrades keep user preferences.

## 🖱️ Computer use

Open **Settings → Computer use** for optional Cua Driver installation, entire-desktop or selected-application access, MCP checks and disconnection. See the [computer-use guide](COMPUTER_USE.md) for setup, OS permissions and validation limits.
