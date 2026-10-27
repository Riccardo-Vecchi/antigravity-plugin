# Changelog

## 1.0.1

- Put all platform commands and installation guides under `linux/` and `windows/`; keep shared guidance in `docs/`.
- Consolidate runtime icons and platform logos under `assets/`.
- Preserve deployed icon file identities and migrate owned Windows launch shortcuts without changing account or preference paths.

## 1.0.0

First release of the unofficial Antigravity plugin. Earlier Git commits were local development iterations, not separately tagged releases.

- Project icons, emoji and colors shared across the sidebar and project selector, plus a compact navigation rail.
- Gemini in the same window, with a persistent isolated session and in-page return button.
- Fixed/dynamic application and supported tray icons, independent startup view, remembered last view, and desktop autostart.
- Configurable view-switch shortcut: record, save, reset or disable it in Settings → Shortcuts; updates apply to the native page and the existing Gemini guest.
- Automatic Linux AppImage/launcher discovery, respecting XDG directories, quoted launchers and explicit overrides; ambiguous installations require selection.
- Shared runtime with Linux/Windows adapters, an explicit distribution manifest, and CI for unit tests and script syntax. Windows remains experimental.
- Seven interface languages with English fallback; local compatibility checks and session-preserving recovery.
- 0BSD license for original integration code; third-party branding remains excluded.
