# Changelog

## 1.8.1

- Separate the shared runtime, Linux integration and Windows integration into `common/`, `linux/` and `windows/`, preserving installer commands and user-data paths.
- Centralize deployed file lists in `distribution.json` and verify platform payloads and relative imports.
- Add Linux-hosted CI for unit/distribution tests and JavaScript, shell, Python and PowerShell syntax; Windows remains experimental.
- Add README badges, privacy notes and additional exclusions for credentials, captures and VM media. License the original integration code under 0BSD, excluding Google branding and other third-party assets.

## 1.8.0

- Add an **experimental** Windows companion using the official signed application runtime, a customized Start-menu launcher, and current-user installation.
- Share project appearance, Gemini switching, shortcuts, localization, and preferences across Linux and Windows.
- Add Windows fixed/dynamic window and native tray icons with temporary loopback inspector attachment and closure reporting.
- Use an owned current-user Startup shortcut for the app autostart checkbox; keep idle-helper startup separate.
- Split platform-specific desktop integration and component versions; retain existing Linux sessions during upgrades.
- Add platform, Windows preferences/autostart, native-controller, and real inspector attachment/closure tests. Document the boundary between automated fixtures and pending Windows desktop validation.

## 1.7.0

- Add Ctrl+Alt+G to switch views from the native page or the official Gemini website, with AltGr/repeat/composition guards.
- Add Remember last view as a third startup choice; persist only the latest view in a separate local session file.
- Add Application → Local customizations with installed version, timestamped compatibility checks, and session-preserving UI reapplication.
- Distinguish repairable helper damage from incompatible native hooks; protect open project editors and orphaned guest sessions.
- Preserve Gemini styles and translated controls across helper reinstalls; refresh translation catalogs without duplicating controllers.
- Translate all new controls in the seven supported languages and add session, shortcut, compatibility, and startup regression tests.

## 1.6.0

- Move startup view and desktop autostart to Application → Startup; keep icon choices in Appearance.
- Localize the additions in English, Italian, German, Spanish, French, Simplified Chinese, and Japanese, with English fallback.
- Update already-open controls, accessible labels, icon search names, and the Gemini return button when the native document language changes.
- Preserve unsaved appearance choices while switching language, and preserve the translation controller during helper reinstalls.
- Await inline-button teardown before upgrading its controller to prevent duplicate buttons/listeners.
- Add translation coverage, placeholder, fallback, and live-input regression tests.

## 1.5.0

- Add Dynamic application icons alongside fixed Antigravity/Gemini choices.
- Update taskbar icons live and synchronize supported Zorin/GNOME tray icons.
- Add an independent startup-view preference and XDG desktop-autostart checkbox.
- Hide Antigravity's menu labels in Gemini and restore them in the native view.
- Preserve open documents while the helper is upgraded.
- Include generic preference/startup tests and restoration instructions.

## Earlier local revisions

- Project icon/emoji/color editor, project-selector inheritance, and compact sidebar.
- Same-window Gemini with persistent session and an in-page return button.
- Fixed application-icon choices and live GNOME icon-cache refresh.
