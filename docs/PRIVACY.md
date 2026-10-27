# Published data

The repository contains integration code, generic test fixtures and settings and user-supplied demonstration screenshots. It does not include Google or Microsoft credentials, cookies, conversations, local project configurations, feedback receipts or Windows VM images.

A review of the five commits through `7951b18` checked 107 unique file blobs and 16 PNGs for personal paths, private email addresses, credential values, private keys and PNG text/EXIF metadata. Those checks found no matching sensitive data. The four documentation screenshots were also inspected visually: they show settings controls, with no account or project details. One historical screenshot includes a validation timestamp and an older helper version; screenshots illustrate the UI and do not certify the current release.

Git history retains the author's name and GitHub no-reply address. Repository links identify the GitHub owner. These are public authorship/account identifiers; no private mailbox was found in commit authorship.

Local diagnostics and laboratory files stay under ignored directories. Additional ignore rules cover environment files, credential containers, traffic captures, crash dumps, VM media and runtime status files. Installers copy only the explicit platform file list in `common/distribution.json`, rather than copying a whole checkout.

This is a bounded review of tracked content and prior repository history, not a guarantee about files stored elsewhere on a user's machine.

The two README demonstration screenshots were supplied by the repository owner for publication. They show a generic project label and a visible profile avatar, but no visible credentials, email address or conversation content.
