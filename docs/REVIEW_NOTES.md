# Review follow-up — 1.14.0

The supplied review was written against 1.12.0. These decisions were checked
against the 1.13.0 source and incorporated in 1.14.0. Review-document structural tests
validate the documents, not the truth of their technical findings.

## Applied

| Review proposal           | Decision                                                                                                                                                                                                                                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-02, Gemini navigation | Correct the demonstrated origin confusion: host-owned identity for authentication/external/unknown pages, truthful window/menu/accessibility names, recovery controls and session-preserving adoption. Renderer `webview.preventDefault()` is ineffective; do not represent it as navigation enforcement. Preserve federated SSO. |
| SEC-03, HTML resources    | Keep the existing opaque sandbox and one-click online-resources action. Exclude the proposed extra consent dialog. Test blocked default resource requests and isolation after enabling online resources.                                                                                                                          |
| QUAL-01                   | Introduce ESLint across authored JavaScript; format the touched core and new files. Remove dead imports, assignments and an accidental update-UI operation reset found by linting.                                                                                                                                                |
| QUAL-02                   | Introduce strict JSDoc/type checks for three small shared modules; keep the scope explicit rather than pretending the full renderer is typed.                                                                                                                                                                                     |
| TEST-01 / TEST-02         | Add real Chromium tests for shipped DOCX, XLSX, PPTX, PDF, Markdown, CSV, HTML and 3D parsers, corruption/size limits, iframe isolation, lazy-loading races, origin chrome and update UI. Keep useful fast existing tests.                                                                                                        |
| TEST-03                   | Consolidate duplicate CDP transports and test out-of-order responses, malformed messages, timeout/send/close failures, events and a real isolated browser endpoint. A full Electron daemon harness remains separate.                                                                                                              |
| ERR-01                    | Add bounded structured daemon diagnostics that omit private raw errors and paths. Keep intentional optional cleanup catches.                                                                                                                                                                                                      |
| DOC-01 / DOC-02 / ECO-01  | Synchronize Linux compatibility notes, add contributor/development guidance and standard package metadata. Do not invent an official plugin manifest.                                                                                                                                                                             |
| Viewer performance        | Load the 2.7 MB parser bundle only on the first non-HTML preview. Share reads, retry failures and prevent stale previews after closure/disable. Bound CSV cell retention to its visible columns.                                                                                                                                  |

## Not copied blindly

- **SEC-01, independent release signing:** useful future hardening, but requires an
  independently protected signing key, bootstrap, rotation and recovery policy.
  Generating a key in the same release environment does not solve compromise of
  that environment. Existing update documentation explicitly trusts the GitHub
  publisher and HTTPS; checksums are not independent signatures. No production
  secrets or trust-root changes were made.
- **Archive and native-code claims:** ZIP expansion limits, opaque preview
  origins, native-binding frame checks, fixed icon values, pinned driver archive
  digests and inspector cleanup already exist. The review's broad claims of
  arbitrary workspace exfiltration or arbitrary icon-request code execution were
  not established. Tests reinforce the actual boundaries.
- **ARM64, KDE portals, macOS, Firefox:** require compatible upstream drivers and
  platform validation; changing an architecture allowlist is not sufficient.
- **QUAL-03:** keep tested, closure-free serialized helpers. A wholesale removal
  would add deployment and lifecycle complexity without demonstrated benefit.
- **FEAT-01 / FEAT-02:** defer a provider registry and filesystem watchers until
  there is a demonstrated catalog limitation or discovery-latency problem.
  Unbounded watchers and a generic registry would add complexity here.
- **DOC-03:** configuration schemas must follow the actual validators, including
  structured shortcuts and current model preferences. The review's sample schema
  is not compatible enough to adopt unchanged.
- **DOC-04:** destructive clean uninstall needs explicit ownership and retention
  choices. Existing disable/recovery and computer-use removal remain available;
  this task does not remove user data.
- **PLAT-01 / PLAT-02 / FEAT-03:** alternative Linux environments and context
  sharing need separate support/privacy design. Do not claim NixOS or portal
  support based on executable lookup alone, or silently send native chat content
  to the embedded Gemini website.

## Verification boundary

Unit, distribution, parser/browser, lint, type and reproducibility checks run
locally. Browser tests use temporary profiles, no Google login and no personal
documents. They do not prove real Google/enterprise SSO, Electron-specific event
delivery, Windows desktop operation or a published CI/release. The official application binary and its profiles are not modified by these plugin changes.
