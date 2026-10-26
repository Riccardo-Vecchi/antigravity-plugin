# Changelog

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
