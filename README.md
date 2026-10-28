<p align="center">
  <img src="assets/logos/antigravity.svg?v=1.2.1" width="84" align="middle" alt="Antigravity logo">
  &nbsp;&nbsp;
  <img src="assets/logos/gemini.png" width="58" align="middle" alt="Gemini logo">
</p>

# 🧩 Antigravity Plugin

[![Version 1.5.0](https://img.shields.io/badge/version-1.5.0-blue)](CHANGELOG.md)
[![Checks](https://github.com/Riccardo-Vecchi/antigravity-plugin/actions/workflows/checks.yml/badge.svg?branch=main)](https://github.com/Riccardo-Vecchi/antigravity-plugin/actions/workflows/checks.yml)
[![Linux verified](https://img.shields.io/badge/Linux-verified-brightgreen)](docs/CONFIGURATION.md)
[![Windows experimental](https://img.shields.io/badge/Windows-experimental-orange)](windows/README.md)
[![Unofficial](https://img.shields.io/badge/Google-unofficial-lightgrey)](NOTICE.md)
[![License 0BSD](https://img.shields.io/badge/license-0BSD-blue)](LICENSE)

**Unofficial plugin** for the Google Antigravity app on **Linux and Windows**. Requires the official Antigravity app to be installed separately.

> [!NOTE]
> Independent project, not affiliated with or endorsed by Google. Antigravity and Gemini names and logos belong to Google. See [NOTICE](NOTICE.md).

## 🖥️ Platforms

| Platform | Status |
| --- | --- |
| 🐧 Linux x86-64 | Verified with Antigravity App 2.28.0 on Zorin/GNOME 46 |
| <img src="assets/logos/windows.svg" width="18" alt="Windows"> Windows 11 x64 | **Experimental**; community-verified installation on 2.27.0; desktop automation validation is pending |

## ✨ Features

- Gemini in the same window, with an in-page return button and a configurable shortcut (default **Ctrl+Alt+G**).
- Guided **Browser use** setup with browser detection, one-click folder copy/open, selected tabs or whole-profile web-tab sharing and existing logins. [Setup](docs/BROWSER_USE.md).
- Optional **computer use** with guided setup for the whole desktop or selected apps. [Setup guide](docs/COMPUTER_USE.md).
- Project icons, emoji and colors through **Project ⋯ → Edit**, shared across the sidebar and project selector.
- Compact sidebar that keeps navigation and project icons visible.
- Settings navigation with icons, dedicated Computer use and Browser use pages and a collapsible Projects group that uses your configured project icons and colors.
- Fixed Antigravity/Gemini icons or a Dynamic mode, including supported tray integrations.
- Startup view, Remember last view, desktop autostart, and patch status/recovery controls.
- English, Italian, German, Spanish, French, Simplified Chinese and Japanese, with English fallback.

## 📸 Screenshots

| Antigravity: project colors and compact sidebar | Gemini in the same window |
| --- | --- |
| ![Antigravity with colored project icons and the compact sidebar](docs/images/antigravity-demo.png) | ![Gemini with the in-page Antigravity return button](docs/images/gemini-demo.png) |

| Settings → Appearance: application and tray icons | Settings → Application: startup view and autostart |
| --- | --- |
| ![Plugin settings for fixed Antigravity or Gemini icons and Dynamic mode](docs/images/preferences.png) | ![Plugin settings for the startup view, remembering the last view and desktop autostart](docs/images/startup.png) |

## 🐧 Install on Linux

Install the **latest official** [Antigravity AppImage](https://antigravity.google/download) and **Node.js 22+** first. Standard GNOME/Zorin desktop components are also used; see the [Linux requirements](linux/README.md#tested-linux-setup) for other distributions.

```bash
git clone https://github.com/Riccardo-Vecchi/antigravity-plugin.git
cd antigravity-plugin
./linux/install.sh
```

Open Antigravity normally. The helper runs as a user service. The AppImage and launcher are detected automatically. Ambiguous installations require an explicit selection; see the [Linux reference](linux/README.md#install-on-linux).

## <img src="assets/logos/windows.svg" width="22" alt="Windows"> Install on Windows

Install the **latest official** [Antigravity app for Windows x64](https://antigravity.google/download) first. The companion uses Windows PowerShell 5.1+ and the app's bundled runtime; no separate Node.js installation or administrator privileges are required.

Download this repository with **Code → Download ZIP**, extract it, and open PowerShell in the extracted folder. Then run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\install.ps1 -Launch
```

Open **Antigravity (customized)** from the Start menu for subsequent launches. The execution-policy option applies only to that invocation. See the [Windows guide](windows/README.md) for custom app paths, integration details, and the exact validation limits.

## ⚙️ Settings and updates

**Computer use:** open **Settings → Computer use**, choose **Entire desktop** or **Selected apps**, and enable it. Works with the native Antigravity agent. On GNOME/Wayland, first setup may require a Linux logout/login. [Setup and troubleshooting](docs/COMPUTER_USE.md).

**Browser use:** open **Settings → Browser use** and follow the extension setup guide.

**Shortcuts** lets you record, save, reset or disable the view-switch shortcut. **Appearance** contains app-icon choices; **Application → Startup** contains launch behavior; **Application → Plugin updates → Plugin customizations** contains status and recovery.

**Plugin updates:** after installing this version once, the plugin checks stable GitHub releases every six hours and installs verified updates automatically when its settings/editors are closed. **Application → Plugin updates → Check for updates** forces an immediate check; you can disable automatic installation or install an available release manually. Local previews and modified plugin files are protected from automatic replacement. See the [update reference](docs/UPDATES.md).

To disable:

- **🐧 Linux:** run `./linux/disable.sh` from the repository. Save any Gemini draft first.
- **<img src="assets/logos/windows.svg" width="18" alt="Windows"> Windows:** run the command in [Update and disable](windows/README.md#update-and-disable).

The official application and conversation databases are not patched. Gemini sign-in stays separate from browser profiles. Detailed settings, session behavior, data locations and Linux recovery are in the [reference](docs/CONFIGURATION.md).

## 🛠️ Development

`common/` contains the shared runtime and UI; `linux/` and `windows/` contain platform adapters and scripts. `common/distribution.json` defines deployment files; stable installed icon paths and older Windows shortcuts remain compatible. Run `node --test tests/*.test.cjs`; CI also checks script syntax. See [privacy notes](docs/PRIVACY.md) for published-data boundaries.

## 📜 License

The original integration code is licensed under [0BSD](LICENSE): use, modify, fork and redistribute it, including commercially, without an attribution requirement. Google branding is excluded; see [NOTICE](NOTICE.md).
