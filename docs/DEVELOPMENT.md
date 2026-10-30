# Development

## Layout and runtime

- `common/`: platform-independent daemon, settings, browser sharing and renderer controls.
- `linux/`, `windows/`: installation, desktop identity, autostart and computer-use adapters.
- `assets/`: logos, icons and the prebuilt, standalone viewer bundle with its notices.
- `scripts/`: development builds and release packaging.
- `tests/`: Node regression tests, Python packaging checks and `browser/` Chromium tests.
- `common/distribution.json`: explicit runtime allowlist. Add new runtime modules here;
  never distribute the development dependencies or test fixtures.

The daemon discovers the official app's local debugging endpoint and injects
versioned controllers. It does not edit the AppImage, application binaries,
official conversation database or Google credentials. `versions.cjs` is the
runtime version source; renderer versions and package metadata must agree with it.

## Boundaries and lifecycle

Native bindings accept only the default execution context of the native main
frame at its local HTTPS origin. Preserve this validation before parsing payloads
or performing file operations. Opaque preview iframes and the Gemini guest must
never receive privileged bindings. Loopback CDP is a local capability, **not an
authentication mechanism**; this project assumes a trusted local desktop account.

The Gemini guest is intentionally retained when switching views. Never recreate
it to refresh presentation: that loses drafts and page state. `prepare-reload.cjs`
hands selected controllers across a helper restart. The separate origin controller
adopts existing guests, displays host-owned identity outside exact Gemini HTTPS,
and updates accessible and window names. It does not restrict enterprise SSO or
claim that renderer `webview` events can cancel navigation. See the
[Electron navigation-event contract](https://www.electronjs.org/docs/latest/api/webview-tag#event-will-navigate).

Every controller owns its listeners, observers, timers and DOM nodes, and exposes
`destroy()`. Cleanup must remove only those resources. Async preview results carry
a generation so closing or disabling Library cannot reopen a stale viewer.
Persistence remains serialized through the existing write chain; callers see
write errors while later operations can recover. Do not use a timeout to release
the chain while an underlying write is still active.

Small helpers serialized with `.toString()` must be closure-free; their tests
exercise that property. This mechanism avoids adding remote scripts or a local
HTTP asset server. Label injected code for debugging when changing its loader;
do not replace the transport or serialization merely for stylistic consistency.

## Checks

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build:viewers
npx playwright install --only-shell chromium
npm run check
python3 -m unittest discover -s tests -p 'test_*.py'
```

- `lint` covers authored common, platform, tooling and test JavaScript. Browser
  worker/fixture globals are declared explicitly; generated vendors are excluded.
- `typecheck` uses strict JSDoc checking for the origin classifier, viewer loader
  and diagnostics. Expand this boundary as modules acquire documented contracts;
  it is not a claim that the full legacy renderer is statically typed.
- `format:check` covers the refactored core and new files. `npm run format` formats
  that same baseline. Keep unrelated legacy files out of formatting-only churn.
- `test` runs fast Node checks, including CDP failures, persistence and distribution.
- `test:browser` runs the actual shipped viewer parsers inside the production
  opaque iframe/CSP, with fixtures rather than user documents. It also exercises
  origin chrome, native titles, the inline fallback layout, update UI state and a
  real local CDP connection. Outputs go to ignored `output/playwright/`.

Browser tests use isolated temporary profiles and no Google account. They verify
DOM and Chromium behavior, not Electron-specific event generation, real SSO,
Linux desktop permissions or Windows shell integration. Report those boundaries
separately from passed automated checks. Do not run the native daemon against a
developer's existing profile as an automated test.

## Viewer build

`npm run build:viewers` bundles `common/viewers.js` and PDF worker code locally.
Commit both generated `assets/viewers/` files when changing their inputs; a clean
rebuild must reproduce them. Runtime installation needs neither npm nor an online
converter. The bundle is loaded by the daemon only on demand, then transferred to
a native frame at its first non-HTML preview. Concurrent loads share one read;
failed reads can retry. HTML does not load the parser bundle.

The build derives third-party notices from esbuild's actual input graph, not all
development packages. Keep license notices with their original package versions.
Retain ZIP expansion budgets, text-content rendering, Markdown sanitation, PDF
eval restrictions and rejection of external 3D assets. HTML retains its opaque
sandbox; the existing one-click **Allow online resources** action enables HTTPS
scripts/resources and requests for that preview. No additional consent modal is
added. Online code can transmit the preview's content. Resource
CSP is not a general guarantee that arbitrary executable HTML has no network effects.

## Diagnostics and local previews

The daemon emits bounded JSON records through `diagnostics.cjs`.
`AGPA_LOG_LEVEL=debug|info|warn|error|off` selects a level. Supply constant event
codes, never user-controlled strings. Records exclude raw exception messages,
stacks, paths, URLs, document contents and request payloads; only known OS error
codes are retained. Repeated records are limited and logger failures cannot stop
the app. Expected optional-integration failures may remain silent; do not replace
every empty catch with a noisy or privacy-sensitive log.

Use a prerelease suite version for unpublished local changes. The updater pauses
automatic replacement of preview builds, and release packaging rejects them.
Publishing, tagging, CI execution and actual desktop verification are separate
steps; local checks do not establish that a release has shipped.

## Outbound Gemini links

`gemini-links.cjs` observes `Page.windowOpen` only for the owned Gemini webview. The native scoped isolated-world API writes a random, temporary challenge, and matching the challenge in a remote target proves ownership before popup observation is enabled. Discovery by URL, title or numeric ID alone is insufficient. No privileged binding is installed in a guest, no popup permission is enabled, and only user-gesture HTTP(S) destinations without credentials are forwarded. The inline isolated-world controller similarly routes trusted outbound anchor clicks; embedded sign-in links retain their session. Both paths clean up on pause/restart and leave Google page-world JavaScript untouched.
