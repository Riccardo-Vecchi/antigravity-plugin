# <img src="../assets/logos/windows.svg" width="24" alt="Windows"> Windows installation (experimental)

This is the Windows companion for Antigravity Plugin. The interface code is shared with Linux. Google's application, ASAR resources, security fuses, account data, and conversation databases are not patched.

**Status:** installation, Start Menu shortcut, application launch and removal were verified by a Windows 11 user with Antigravity 2.27.0 and Windows PowerShell 5.1 (PR #1). Broader desktop and browser automation verification remains pending; Windows support is experimental.

## Requirements

- Windows 11 x64.
- The **latest official Antigravity app**, Windows x64 build, installed from [Google](https://antigravity.google/download).
- Windows PowerShell 5.1 or later, available with Windows.
- A normal interactive Windows user session. Administrator privileges are not required for the companion.

The installer accepts unsigned builds because the official Windows 2.27.0 executable was reported as `NotSigned`. When a signature is present, it must be valid and identify Google LLC. An unsigned executable cannot be authenticated by that check: download the base app only from Google. The installer also checks the runtime capabilities used by the companion. A future Google build can disable those capabilities; the installer will report the incompatibility instead of modifying the executable or its security settings.

The community-tested installation baseline is Antigravity 2.27.0. Newer app builds must pass the runtime checks.

## Install and launch

Clone or download this repository. From its directory, run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\install.ps1 -Launch
```

For a nonstandard application location:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\install.ps1 -AppExe 'D:\Apps\Antigravity\Antigravity.exe' -Launch
```

The invocation's execution policy applies to that process only. The installer does not change the system execution policy.

Use **Antigravity (customized)** in the Start menu. It launches the official application and attaches the companion. If Antigravity is already running, the launcher focuses it without restarting it. In that case, native icon changes become available after the next launch through the customized shortcut; open pages and drafts are not discarded automatically.

The shared controls remain in the same locations:

- **Settings → Appearance:** Antigravity, Gemini, or Dynamic icons.
- **Settings → Application → Startup:** startup view, Remember last view, and launch at sign-in.
- **Settings → Application → Local customizations:** helper version, interface checks, and UI reapplication.
- **Settings → Shortcuts:** configurable view switching (Ctrl+Alt+G by default), including reset and disable.
- **Project ⋯ → Edit:** project icons, emoji, colors, and search.

Translations and English fallback behave as described in the main README.

## Native window and tray icons

The customized launcher briefly enables the application's existing main-process inspector on a random **127.0.0.1** port. It attaches a small controller to the existing Electron window/tray objects and closes that inspector after setup. A safety timer also closes it if attachment is interrupted. Native icon availability is reported only after the controller confirms inspector closure.

The controller reads an enum-only local icon request and uses Electron's native icon APIs. The original tray and its menu are retained. Google's website receives no new native bridge, credentials, or filesystem access. The existing renderer debugging endpoint used for UI additions remains separate.

The native controller handles subsequent icon changes without reopening the inspector. It retains the official icon for restoration and updates new app windows. A local heartbeat prevents an old status file from being treated as a live controller.

Windows can cache pinned shortcut icons. The customized shortcut is the intended launch path; pinned-item behavior must be checked on the target Windows desktop.

## Startup behavior

The current-user Run entry `AntigravityLocalCustomizations` starts the idle helper at sign-in. It does not itself launch Antigravity.

The app's **Launch at desktop sign-in** checkbox independently creates/removes its owned `Antigravity Customizations.lnk` in the current user's Startup folder. It launches the customized entry point, so the selected startup view and icon mode can be applied. Other startup entries created outside this project are not removed or overridden.

## Local files

```text
%LOCALAPPDATA%\antigravity-project-appearance\          companion code and icons
%APPDATA%\antigravity-project-appearance\app.json       preferences
%APPDATA%\antigravity-project-appearance\projects.json  project styles
%APPDATA%\antigravity-project-appearance\session.json   last view only
%APPDATA%\antigravity-project-appearance\installation.json
%APPDATA%\antigravity-project-appearance\windows-icon-request.json
%APPDATA%\antigravity-project-appearance\windows-native-status.json
%APPDATA%\antigravity-project-appearance\helper.log
%APPDATA%\antigravity-project-appearance\launcher.log
```

The official app profile remains `%APPDATA%\Antigravity`. The embedded Gemini web session is separate from the native app's login and from browser profiles. Sign in inside the website when needed; credentials and browser cookies are not imported.

## Update and disable

To update, run `windows\install.ps1` again from the updated repository. Finish any settings operation before doing so. The helper is restarted; the native application is not automatically closed.

To disable:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\antigravity-project-appearance\windows\disable.ps1"
```

This restores the native icon choice, removes the companion's owned Start-menu shortcut, app-autostart shortcut, and idle-helper Run entry, and stops the helper. Reopen Antigravity normally to remove the injected UI. Preferences and Google's session stay on disk; the current guest is left mounted until the app closes so an unsent draft is not discarded by disabling the helper.

## Validation status

| Check | Result |
| --- | --- |
| Shared code and adapter tests | Tests run on Linux in CI, including Windows path/state behavior, native-controller validation/restoration, and real loopback inspector attachment/closure in a Node fixture |
| PowerShell syntax | PowerShell scripts are syntax-checked by Linux CI; this does not execute Windows APIs |
| Linux regression | Linux helper upgrades preserve project styles, preferences and the official AppImage. Earlier live checks preserved the Gemini guest and passed compatibility |
| Windows laboratory | A separate clean Windows 11 VM reached the desktop; this establishes the test environment only |
| Actual Windows application integration | **Not yet verified**: installer execution under Windows PowerShell 5.1, native window/tray icons, pinned shortcuts, sign-in autostart, and authenticated application workflows |

Windows desktop testing was deliberately limited for this revision. The automated tests use fixtures for Windows APIs; they are not a claim that the taskbar, tray, or autostart already passed a live Windows check. No Microsoft or Google account data is included in the repository.

## 🖱️ Computer use

Open **Settings → Computer use** for optional Cua Driver installation, entire-desktop or selected-application access, MCP checks and disconnection. See the [computer-use guide](../docs/COMPUTER_USE.md) for setup, OS permissions and validation limits.

### Confidence and remaining validation

Computer use already has a Windows x64 adapter, official driver/UI Automation helper extraction, and the shared MCP bridge, scope controls, wizard and settings. The enable switch, red removal button and activity indicators use that shared interface; they do not require a separate Windows UI implementation.

A source review alone cannot establish live reliability for Windows applications, elevated windows, display scaling, multiple monitors or interactive/locked/remote sessions. These remain target-system validation questions. No Windows runtime tests or VM runs were performed for this revision; Windows computer use remains **experimental**, not production-verified.
