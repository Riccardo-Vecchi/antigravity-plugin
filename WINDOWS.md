# Windows installation (experimental)

This is the Windows companion for Antigravity Customizations. The interface code is shared with Linux. Google's signed application, ASAR resources, security fuses, account data, and conversation databases are not patched.

**Status:** implemented, with automated adapter tests and PowerShell syntax checks. Full Windows application and desktop verification is pending. Use this companion as an experimental port.

## Requirements

- Windows 11 x64.
- The official **Antigravity App 2.26.0**, Windows x64 build, installed from [Google](https://antigravity.google/download).
- Windows PowerShell 5.1 or later, available with Windows.
- A normal interactive Windows user session. Administrator privileges are not required for the companion.

The installer checks the application's Google Authenticode signature and the runtime capabilities used by the companion. A future Google build can disable those capabilities; the installer will report the incompatibility instead of modifying the executable or its security settings.

## Install and launch

Clone or download this private repository using your GitHub account. From its directory, run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-windows.ps1 -Launch
```

For a nonstandard application location:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-windows.ps1 -AppExe 'D:\Apps\Antigravity\Antigravity.exe' -Launch
```

The invocation's execution policy applies to that process only. The installer does not change the system execution policy.

Use **Antigravity (customized)** in the Start menu. It launches the official application and attaches the companion. If Antigravity is already running, the launcher focuses it without restarting it. In that case, native icon changes become available after the next launch through the customized shortcut; open pages and drafts are not discarded automatically.

The shared controls remain in the same locations:

- **Settings → Appearance:** Antigravity, Gemini, or Dynamic icons.
- **Settings → Application → Startup:** startup view, Remember last view, and launch at sign-in.
- **Settings → Application → Local customizations:** helper version, interface checks, and UI reapplication.
- **Settings → Shortcuts:** Ctrl+Alt+G view switching.
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

To update, run `install-windows.ps1` again from the updated repository. Finish any settings operation before doing so. The helper is restarted; the native application is not automatically closed.

To disable:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\antigravity-project-appearance\disable-windows.ps1"
```

This restores the native icon choice, removes the companion's owned Start-menu shortcut, app-autostart shortcut, and idle-helper Run entry, and stops the helper. Reopen Antigravity normally to remove the injected UI. Preferences and Google's session stay on disk; the current guest is left mounted until the app closes so an unsent draft is not discarded by disabling the helper.

## Validation status

| Check | Result |
| --- | --- |
| Shared code and adapter tests | 39 tests passed on Linux, including Windows path/state behavior, native-controller validation/restoration, and real loopback inspector attachment/closure in a Node fixture |
| PowerShell syntax | PowerShell scripts are syntax-checked by Linux CI; this does not execute Windows APIs |
| Linux regression | Helper 1.8.1 installed and running from the new layout while the app was closed; project styles, preferences and AppImage hashes were unchanged. Earlier 1.8.0 live checks preserved the Gemini guest and passed compatibility |
| Windows laboratory | A separate clean Windows 11 VM reached the desktop; this establishes the test environment only |
| Actual Windows application integration | **Not yet verified**: installer execution under Windows PowerShell 5.1, native window/tray icons, pinned shortcuts, sign-in autostart, and authenticated application workflows |

Windows desktop testing was deliberately limited for this revision. The automated tests use fixtures for Windows APIs; they are not a claim that the taskbar, tray, or autostart already passed a live Windows check. No Microsoft or Google account data is included in the repository.
