# 🧭 Context window

The global indicator sits immediately before the model selector. It is hidden in new chats until conversation data is available. Hover for a graphical overview of utilization and tokens used. Click for the breakdown of instructions, tools, conversation and available input, cache and output counters. No per-turn token badges, deltas or footprint calculations are performed.

## 🔎 Native controls first

When Antigravity provides its own `context-usage-indicator`, the plugin leaves its values, popup and behavior native and hides the fallback. No rollout flags or account preferences are changed.

The fallback uses the latest available transcript API counters and local estimates. Model capacities inferred from labels and locally estimated system/tool/rule components are approximate; they are not a guarantee of the host's active context. Cache counters are not counted twice. Unknown breakdown categories remain unavailable instead of being invented.

For models with a documented or observed compaction limit, the fallback ring shows progress toward that limit. The click panel shows the tokens remaining before compaction and the estimated model capacity. For other models, the ring uses the estimated model capacity. The threshold is an estimate and can vary with the host version or configuration.

The 256,000-token estimate is scoped to Gemini 4 Argon, Carbon and Hydrogen, both named Orchestrator variants, and Claude Opus/Sonnet 5.5. [Google’s Desktop forum response for Argon](https://discuss.ai.google.dev/t/enable-larger-than-250k-gemini-context-sizes-in-antigravity-desktop/198191/2) describes automatic compaction around 250k. Independent IDE catalog observations report 256,000 for [Argon](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/tag/v1.16.19), [Carbon](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/tag/v1.16.20), [Hydrogen](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/tag/v1.17.0), [Orchestrator](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/tag/v1.17.1) and [Claude 5.5](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/tag/v1.16.18).

## ⚙️ Implementation

- `common/transcript-reader.cjs` reads bounded, regular local transcript files. It keeps the latest input/cache/output counters and aggregate text/image totals, caches unchanged files, and never scrolls the conversation.
- `common/context-budget.cjs` maintains global conversation statistics and calibration. It ignores legacy per-turn telemetry when hydrating or restoring state.
- `common/context-budget.js` renders the compact global ring and its popup, including keyboard dismissal, accessible labeling and viewport clamping. It does not decorate individual responses.
- The daemon rejects transcript requests while the plugin is disabled or busy. Controller teardown removes injected elements and listeners without changing native controls.

An optional **Compact context** action prepares `/compact` in the native editor; it does not send the command automatically. Local estimates and cached statistics remain local. Original transcripts are read-only.

## ✅ Verification

Regression checks cover global counter preservation, legacy per-turn data removal, empty-chat visibility, native context handoff, the position before the model selector, popup breakdowns and responsive placement. Linux is verified interactively; browser fixtures do not constitute a Windows OS test.
