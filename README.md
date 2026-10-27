<p align="center">
  <img src="assets/antigravity.svg" width="58" alt="Antigravity logo">
  &nbsp;&nbsp;
  <img src="assets/gemini.png" width="58" alt="Gemini logo">
</p>

# Antigravity Customizations

[![Version 1.8.1](https://img.shields.io/badge/version-1.8.1-blue)](CHANGELOG.md)
[![Checks](https://github.com/Riccardo-Vecchi/antigravity-customizations/actions/workflows/checks.yml/badge.svg?branch=main)](https://github.com/Riccardo-Vecchi/antigravity-customizations/actions/workflows/checks.yml)
[![Linux verified](https://img.shields.io/badge/Linux-verified-brightgreen)](docs/REFERENCE.md)
[![Windows experimental](https://img.shields.io/badge/Windows-experimental-orange)](WINDOWS.md)
[![Unofficial](https://img.shields.io/badge/Google-unofficial-lightgrey)](NOTICE.md)
[![License 0BSD](https://img.shields.io/badge/license-0BSD-blue)](LICENSE)

Unofficial additions for Google Antigravity on **Linux and Windows**, kept separate from the official application.

**Independent project, not affiliated with or endorsed by Google. Antigravity and Gemini names and logos belong to Google.** See [NOTICE](NOTICE.md).

| Platform | Status |
| --- | --- |
| Linux x86-64 | Verified with Antigravity App 2.26.0 on Zorin/GNOME 46 |
| Windows 11 x64 | **Experimental**; full desktop verification is pending |

## Features

- Project icons, emoji and colors through **Project ⋯ → Edit**, shared across the sidebar and project selector.
- Compact sidebar that keeps navigation and project icons visible.
- Gemini in the same window, with an in-page return button and **Ctrl+Alt+G** switching.
- Fixed Antigravity/Gemini icons or a Dynamic mode, including supported tray integrations.
- Startup view, Remember last view, desktop autostart, and patch status/recovery controls.
- English, Italian, German, Spanish, French, Simplified Chinese and Japanese, with English fallback.

## Install on Linux

Install the official [Antigravity AppImage](https://antigravity.google/download) first. Requires Node.js 22+, Python 3 with PyGObject/Gio, a user systemd session, and GTK/desktop icon tools.

```bash
git clone https://github.com/Riccardo-Vecchi/antigravity-customizations.git
cd antigravity-customizations
./install.sh
```

Open Antigravity normally. The helper runs as a user service. Default AppImage/launcher paths and overrides are listed in the [Linux reference](docs/REFERENCE.md#install-on-linux); check them before using app-icon controls on another setup.

## Install on Windows

Install the official [Antigravity App 2.26.0 for Windows x64](https://antigravity.google/download) first. The companion uses Windows PowerShell 5.1+ and the signed app's bundled runtime; no separate Node.js installation or administrator privileges are required.

Download this repository with **Code → Download ZIP**, extract it, and open PowerShell in the extracted folder. Then run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-windows.ps1 -Launch
```

Open **Antigravity (customized)** from the Start menu for subsequent launches. The execution-policy option applies only to that invocation. See the [Windows guide](WINDOWS.md) for custom app paths, integration details, and the exact validation limits.

## Settings and updates

**Appearance** contains app-icon choices; **Application → Startup** contains launch behavior; **Application → Local customizations** contains status and recovery.

To update, get the latest source and rerun the installer for your platform. To disable:

- **Linux:** run `./disable.sh` from the repository. Save any Gemini draft first.
- **Windows:** run the command in [Update and disable](WINDOWS.md#update-and-disable).

The official application and conversation databases are not patched. Gemini sign-in stays separate from browser profiles. Detailed settings, session behavior, data locations and Linux recovery are in the [reference](docs/REFERENCE.md).

## Development

`common/` contains the shared runtime and UI; `linux/` and `windows/` contain platform adapters and scripts. Root installer commands remain stable. `distribution.json` defines the files each installer deploys. Run `node --test tests/*.test.cjs`; CI also checks script syntax. See [privacy notes](PRIVACY.md) for published-data boundaries.

The original integration code is licensed under [0BSD](LICENSE): use, modify, fork and redistribute it, including commercially, without an attribution requirement. Google branding is excluded; see [NOTICE](NOTICE.md).
