# 🧭 Context window

The global indicator sits immediately before the model selector. It is hidden in new chats until conversation data is available. Open it for context utilization, the estimated capacity, a breakdown of instructions/tools, conversation and free space, and available input/cache/output counters. No per-turn token badges, deltas or footprint calculations are performed.

## 🔎 Native controls first

When Antigravity provides its own `context-usage-indicator`, the plugin leaves its values, popup and behavior native and hides the fallback. No rollout flags or account preferences are changed.

The fallback uses the latest available transcript API counters and local estimates. Model capacities inferred from labels and locally estimated system/tool/rule components are approximate; they are not a guarantee of the host's active context. Cache counters are not counted twice. Unknown breakdown categories remain unavailable instead of being invented.

## ⚙️ Implementation

- `common/transcript-reader.cjs` reads bounded, regular local transcript files. It keeps the latest input/cache/output counters and aggregate text/image totals, caches unchanged files, and never scrolls the conversation.
- `common/context-budget.cjs` maintains global conversation statistics and calibration. It ignores legacy per-turn telemetry when hydrating or restoring state.
- `common/context-budget.js` renders the compact global ring and its popup, including keyboard dismissal, accessible labeling and viewport clamping. It does not decorate individual responses.
- The daemon rejects transcript requests while the plugin is disabled or busy. Controller teardown removes injected elements and listeners without changing native controls.

An optional **Compact context** action prepares `/compact` in the native editor; it does not send the command automatically. Local estimates and cached statistics remain local. Original transcripts are read-only.

## ✅ Verification

Regression checks cover global counter preservation, legacy per-turn data removal, empty-chat visibility, native context handoff, the position before the model selector, popup breakdowns and responsive placement. Linux is verified interactively; browser fixtures do not constitute a Windows OS test.
