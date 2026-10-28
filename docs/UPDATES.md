# 🔄 Plugin updates

Install version 1.2.3 or later once using the normal Linux or Windows installer. Then open **Settings → Application → Plugin updates**.

- **Automatically install plugin updates** is enabled by default for managed stable installations. The helper checks every six hours, beginning shortly after startup. Checks run only while the helper is running.
- **Check for updates** always contacts GitHub immediately, independently of the scheduled-check timestamp. It also works with automatic updates disabled. Network errors and GitHub rate limiting are shown in the page.
- **Install update** applies an available release manually. Automatic installation waits until plugin settings/editors are closed and Computer use setup is idle.
- The page shows the installed version, latest stable release, last-check time and progress/errors. Prereleases and downgrades are excluded.

## 🔒 Preservation and recovery

The updater uses release assets from **Riccardo-Vecchi/antigravity-plugin**, independently of Antigravity's own updater. It verifies compressed size, SHA-256, decoded file hashes, platform, version and the exact distribution manifest before changing installed files. Relative traversal, duplicate paths and symlink destinations are rejected. GitHub HTTPS and repository ownership are the trust boundary; a SHA-256 digest provides integrity, not independent publisher signing.

Only files inside the plugin installation are replaced. The official app, conversation/profile data and plugin preferences are preserved. The service keeps native/Gemini documents mounted during restart. Temporary transaction data is removed after success. If the new helper does not start, the worker restores the previous payload and restarts it; a failed rollback or OS/process interruption still requires rerunning the platform installer.

An installation receipt detects code modifications made after installation. Custom source/fork builds should use a prerelease version to retain preview protection. Modified installations and `-dev`/prerelease builds continue to support **Check for updates**, but automatic replacement is paused so unpublished customizations are not lost. The receipt is refreshed when you rerun the installer. Updates do not modify a source Git checkout.

## 🖥️ Platforms

Linux uses an independent user-systemd update worker so restarting the plugin does not terminate its installer. Windows uses a detached worker and the current-user launcher. Neither requires administrator rights or a separate privileged service. Windows remains experimental and has not been runtime-tested for this feature.

Configuration and status live in the plugin configuration directory under `updates/`. Packages contain no personal configuration, conversations, credentials or Cua Driver installation. Releases must be immutable: publish a higher version instead of replacing an existing tag/package.

## 🛠️ Maintainers

`scripts/build-update.cjs` creates both platform payloads and `plugin-update.json` from `common/distribution.json`. The release workflow checks the version against its `vX.Y.Z` tag, runs the regression suite, builds the payloads and uploads them to that release. No build tools or Git are needed on installed clients.

## One-time folder migration

Version 1.5 moves older `antigravity-project-appearance` installations and settings to `antigravity-plugin`. Linux uses `~/.local/share/antigravity-plugin` and `~/.config/antigravity-plugin`; Windows uses `%LOCALAPPDATA%\antigravity-plugin` and `%APPDATA%\antigravity-plugin`. The extension stays inside the installation root. There are no permanent compatibility-directory aliases.

A client updating from an older release first completes the existing updater’s health check. An independent migration worker then stops the owned helper, verifies and moves its files, updates owned MCP/launcher/Native Messaging references and starts the canonical helper. Conflicting destination files stop migration; failures retain recoverable data rather than replacing conflicting user settings. Native Antigravity profiles and conversations are not relocated. Source installers perform the same migration.

An unpacked extension that still points into the removed folder needs to be loaded from the new folder through the guided setup. Existing native icon watchers on Windows are stopped before moving their paths; the running Antigravity app stays open. Native Windows icon switching becomes available again after the next customized app launch. Windows source/adapter checks do not replace a target-machine runtime test.
