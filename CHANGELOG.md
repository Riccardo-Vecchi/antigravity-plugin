# Changelog

## 1.2.2

- Update the verified Linux compatibility baseline to Antigravity App 2.27.0, reported working by the repository owner.
- Enable Apply access changes only for actual unsaved scope/allowlist changes; keep it gray otherwise.
- Use the top switch as the single connection control, including setup cancellation; retain Cancel setup only in the progress dialog.
- Simplify Disabled mode to access choices, removal and installation details. Remove the ellipsis from the removal button.

## 1.2.1

- Make the Antigravity README logo transparent by removing only the SVG favicon background.

- Add a top-level enable/disable switch sharing the existing connection state; keep setup when switched off.
- Move removal beside Stop and disconnect, style it red, and remove the redundant capture-explanation paragraph.
- Keep activity spinners rotating under reduced-motion preferences, without changing the OS setting.
- Match the Settings Projects label to the other navigation entries at 14 px and clarify Windows confidence limits after source review.

## 1.2.0

- Show a setup progress dialog with real phase labels, downloaded bytes, per-step spinners and background/Stop controls.
- Automatically test screen capture once Entire desktop access is ready, without retry loops or capture in Selected apps mode.
- Add an upstream Cua Driver version check beside the reviewed version, with a result dialog and prerelease disclosure; retain reviewed hash-pinned installation.
- Use a pointer icon for Computer use navigation and translate all new controls into the seven supported languages.

## 1.1.2

- Show Linux logout/login instructions directly beside the pending GNOME check and explain that lock/unlock keeps the same session.
- Remove repeated driver/handshake status paragraphs and show the driver version in its check row.
- Center computer-use removal in a modal confirmation with Cancel/Escape, visible progress and results beside the controls.

## 1.1.1

- Replace the oversized desktop-activation title with a compact notice and explicit Linux logout/login instructions; distinguish installed GNOME files from a loaded extension.
- Show separate connection checks with green checkmarks and orange pending dots, plus an optional screen-capture diagnostic that discards image data.
- Add confirmed removal and fresh setup for plugin-managed computer-use components, preserving shared helpers, other MCP servers and edited skills.
- Translate the new controls into all seven supported languages and shorten the Linux quick-start requirements.

## 1.1.0

- Add optional computer use for the native Antigravity agent through maintained Cua Driver 0.37.0, with hash-verified downloads and no deprecated packages.
- Add a dedicated Computer use Settings page and seven-language one-click setup, with Entire desktop and Selected apps modes. Preserve other MCP servers and user skills.
- Use standard driver permissions for Entire desktop and bounded sessions for Selected apps, with filtered tools, disabled driver telemetry and revocation on stop or scope changes.
- Add Settings navigation icons and a persistent, collapsible Projects group with the same configured icons, emoji and colors as the sidebar.
- Add Linux GNOME/Wayland helper setup and experimental Windows x64 support using the existing bundled runtime.

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
