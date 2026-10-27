# Published data

The repository contains integration code, generic test fixtures and settings and user-supplied demonstration screenshots. It does not include Google or Microsoft credentials, cookies, conversations, local project configurations, feedback receipts or Windows VM images.

A review of the five commits through `7951b18` checked 107 unique file blobs and 16 PNGs for personal paths, private email addresses, credential values, private keys and PNG text/EXIF metadata. Those checks found no matching sensitive data. The four documentation screenshots were also inspected visually: they show settings controls, with no account or project details. One historical screenshot includes a validation timestamp and an older helper version; screenshots illustrate the UI and do not certify the current release.

Git history retains the author's name and GitHub no-reply address. Repository links identify the GitHub owner. These are public authorship/account identifiers; no private mailbox was found in commit authorship.

Local diagnostics and laboratory files stay under ignored directories. Additional ignore rules cover environment files, credential containers, traffic captures, crash dumps, VM media and runtime status files. Installers copy only the explicit platform file list in `common/distribution.json`, rather than copying a whole checkout.

This is a bounded review of tracked content and prior repository history, not a guarantee about files stored elsewhere on a user's machine.

The two README demonstration screenshots were supplied by the repository owner for publication. They show a generic project label and a visible profile avatar, but no visible credentials, email address or conversation content.

## Optional computer use

The optional Cua Driver integration stores access scope, selected local executable paths, a capability manifest and its own MCP entry locally. Disconnecting removes only that entry and retains the choices. These files are not published. **Entire desktop** enables observation and GUI control across the desktop using the driver's normal `standard` permission mode. Screen content, windows and screenshots can contain private information and are returned to the model used by Antigravity during a task. **Selected apps** uses `bounded` mode and an executable allowlist. The plugin disables Cua telemetry in its driver environment and adds no blanket Antigravity approvals. Its tool filter excludes direct shell/file tools and browser-profile attachment; operating an application through its GUI can still affect files, signed-in websites and other state. Driver files and the owned local skill are retained when disconnected. The Settings Projects collapse preference is saved locally in the app's local storage. See [computer-use scope and setup](COMPUTER_USE.md).

The Computer use documentation screenshot shows only the Settings UI, cropped above the account footer with the Projects group collapsed. It contains no account identifier, chat content or local executable path.

The optional **Test screen capture** diagnostic captures once in the local driver process, discards the returned image in memory and reports only success/pending status. It does not send that diagnostic image to a model or save it through the plugin. **Remove computer use…** revokes the connection and removes the verified plugin-managed driver, own MCP entry, setup files and unchanged generated skill. Shared GNOME helper files, other Cua installations and locally edited skills are preserved.
