# Antigravity 2.29 compatibility

Compatibility audit for plugin 1.17.0 on Linux, 4 November 2026.

## Native features take priority

- Standard sidebar opening and closing use the native layout and animation.
  The plugin retains the compact icon rail and optional hover overlay.
- The native context-usage control takes priority as soon as it appears. Its
  counters, popup and events remain native. A compact estimated ring is retained
  only while the native control is unavailable in the rollout. No feature flags
  or native preferences are changed.
- Native permission icons, keyboard-shortcut settings, voice mode and notebook
  previews are retained. The plugin only adds its Gemini-switch shortcut; it does
  not replace native shortcut customization or implement a competing voice mode.
- Browser use still connects an existing Chromium browser profile; the native
  built-in browser does not replace that integration. Library remains an artifact
  catalogue with document/3D previews, rather than a competing notebook viewer.

## Compatibility repairs

- Resolve virtualized sidebar project headers through their stable section IDs;
  keep support for legacy section links and new project links. Do not guess a
  project from ambiguous names. Preserve saved appearance preferences.
- Restore colors/icons in the sidebar, selector, settings and compact rail, plus
  the project Edit action. Use the current project link when opening a project.
- Use conversation search in the compact rail, replacing the retired History
  shortcut. Preserve native settings icons where present.
- Dock the native Usage submenu beside its sidebar button under Onyx/glass
  styling. Hidden menu ancestors must not establish a fixed-position containing
  block through transforms, transform hints or backdrop filters.
- Limit project-decoration scans to relevant UI changes, with no idle polling.
  Cache unchanged transcripts, stop programmatic scroll hydration, reject
  transcript requests while the plugin is disabled, and dispose of context and
  Teamwork controllers when the daemon detaches.

## Verification boundaries

Regression fixtures cover both legacy and 2.29 project identity, menu editing,
compact navigation, ambiguous labels, streamed text, context handoff and native
Usage placement. Existing automated checks cover parsers and isolated browser
behavior. These are distinct from live Linux checks; Windows has no new live
validation in this audit.

Official release notes: <https://antigravity.google/docs/changelog?tab=hub>.

## Recorded local results

- 385 Node tests, 3 Python checks and 36 isolated browser checks passed, plus
  lint, type and formatting checks. Browser checks used an installed Chromium
  headless shell in disposable profiles.
- On the running Linux 2.29.0 instance: all 5 project IDs resolved and all 5 saved
  styles rendered; selector icons and the Edit dialog were checked. Compact and
  expanded navigation and the Gemini round trip were verified.
- The context ring was visible immediately before the model. Usage's lower edge
  matched its sidebar anchor exactly while retaining the native glass styling.
- Native context replacement is tested with a fixture; no rollout flags were
  forced on the real account. Windows was not exercised live.

## Driver and reasoning-control follow-up

- Cua Driver 0.38.0 is the latest regular upstream release as checked on
  4 November 2026. GitHub's prerelease label is monorepo release routing; the
  versioned upstream notes classify plain Driver SemVer releases as stable.
  All supported binary assets remain SHA-256 pinned. Linux MCP advertised the
  expected 17 allowed tools and its desktop capture check succeeded after the
  upgrade, preserving the existing desktop scope and active GNOME helper.
- A new chat has no fallback context ring. Existing conversations retain a
  percentage ring, colored instruction/conversation usage and expandable
  system/tool/rule estimates where a consistent baseline exists.
- Native submenu delays now permit retry instead of permanently disabling a
  model's effort control. Slow-rendering, interrupted-menu, keyboard, memory
  and Teamwork regression flows pass in Chromium. The live Linux slider's
  preview was canceled and its native model selection remained unchanged.
  These checks do not reproduce a specific Windows report or validate a
  Windows installation.
