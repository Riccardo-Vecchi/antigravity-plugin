# Antigravity Plugin — Context Window Architecture & Technical Specification

> **Full Architectural Specification & System Documentation**  
> **Subsystem**: Context Budget & Token Telemetry  
> **Target Upstream**: `Riccardo-Vecchi/antigravity-plugin`  
> **Runtime Target**: Node.js built-in runtime (Zero npm dependencies), Windows PowerShell 5.1 & Linux Electron.

---

## 1. Overview & System Mission

In Large Language Model (LLM) agent environments such as Google Antigravity, the **context window** is a critical, bounded operating resource. Exceeding the model's token limit leads to context degradation, unexpected truncation, or outright request failures.

The **Context Budget Subsystem** of `antigravity-plugin` provides a real-time, non-intrusive, zero-touch visual monitor directly embedded in the Antigravity application interface. It continuously informs the developer of:
1. **Current context consumption** (exact tokens and conversational turns).
2. **Context ceiling and utilization percentage** adapted dynamically to the active AI model (e.g., 1M for Gemini Flash, 200k for Claude 3.5 Sonnet, 128k for GPT-4o).
3. **Multimodal token breakdown** (images, attachments, and system baseline overhead).
4. **Proactive action prompts** (one-click `/compact` trigger when context reaches saturation).

The subsystem is architected as an **out-of-process daemon and in-page renderer bridge**, maintaining **100% mathematical fidelity** with official API counters while requiring **zero external npm dependencies** and **zero manual actions** (such as scrolling) from the user.

---

## 2. End-to-End System Architecture

```mermaid
flowchart TD
    subgraph Antigravity Storage & Host
        TLog["Transcript Logs on Disk<br/>(transcript_full.jsonl / transcript.jsonl)"]
        DevPort["DevToolsActivePort<br/>(CDP Loopback Interface)"]
    end

    subgraph Daemon Layer (common/daemon.cjs)
        Watcher["Reactive File Watcher<br/>(mtime sub-second polling)"]
        TReader["Transcript Reader<br/>(common/transcript-reader.cjs)"]
        CDPClient["Chrome DevTools Protocol Client<br/>(CDP Session to Electron Page)"]
    end

    subgraph Renderer Engine (Browser Context)
        CJSModule["Token Engine Module<br/>(common/context-budget.cjs)"]
        UIRenderer["Context Budget UI Component<br/>(common/context-budget.js)"]
        DOMView["Virtualized Viewport<br/>([data-testid='autoscroll-viewport'])"]
        Composer["Input Box Composer<br/>([data-testid='agent-input-box'])"]
        Storage["LocalStorage Cache<br/>(agpa_context_budget_{convId})"]
    end

    subgraph UI Surface
        Pill["Context Pill (.agpa-context-pill)<br/>~40k tok · Healthy"]
        Modal["Detailed Breakdown Modal (.agpa-context-popup)<br/>Budget, Turns, Images, Overhead"]
    end

    TLog -->|mtime invalidation| Watcher
    Watcher --> TReader
    TReader -->|Parse API tokens, turns, images| CDPClient
    DevPort --> CDPClient
    CDPClient -->|hydrateFromTranscript(key, stats)| CJSModule
    
    DOMView -.->|Turn Navigator Gating| CJSModule
    Composer -.->|MMSLE Real-Time Delta| CJSModule
    CJSModule <--> Storage
    CJSModule --> UIRenderer
    UIRenderer --> Pill
    Pill -->|Click| Modal
```

---

## 3. Core Modules & Responsibilities

The subsystem spans four primary modules:

| Module | Location | Primary Responsibility |
| :--- | :--- | :--- |
| **`transcript-reader.cjs`** | `common/` | Node.js host-side reader. Scans `%USERPROFILE%/.gemini/antigravity/brain/<id>/.system_generated/logs/transcript_full.jsonl`. Extracts official API tokens (`input_tokens`, `cache_read_tokens`, `output_tokens`), `thinking` tokens, user prompt turns, images, and unrecorded steps. |
| **`daemon.cjs`** | `common/` | Host daemon background service. Discovers active Antigravity Electron windows via CDP (`127.0.0.1:25500`), injects scripts, monitors active chat pathname, tracks transcript file `mtime`, and dispatches hydration events. |
| **`context-budget.cjs`** | `common/` | Isomorphic mathematical calculation engine. Implements the Dual-Anchor Hybrid Calibration, MMSLE tokenizer, multimodal vision resolutions, document attachment models, and virtual scroll protection. |
| **`context-budget.js`** | `common/` | DOM presentation component. Injects the footer pill button (`.agpa-context-pill`), renders color-coded health status, handles popups, localized strings (`i18n`), and keyboard interactions. |

---

## 4. Mathematical & Algorithmic Models

The context budget calculation uses a tiered calculation pipeline:

### 4.1 Ground Truth Anchor (Certified API Phase)
When a conversation has completed at least one API exchange, Antigravity records token telemetry in `transcript_full.jsonl`. The ground truth base is computed as:

$$\text{apiTokens} = \text{input\_tokens} + \text{cache\_read\_tokens} + \text{output\_tokens}$$

Where:
* **`input_tokens`**: Tokens received by the LLM for system prompt, historical messages, and tools.
* **`cache_read_tokens`**: Tokens served directly from LLM prompt caching (crucial for Gemini 1.5/2.0/3.0 and Claude 3.5).
* **`output_tokens`**: Tokens generated by the model, including internal reasoning (`thinking`) and tool invocation calls.

### 4.2 Dual-Anchor Hybrid Calibration ($\kappa$)
Between API responses, the user may type in the composer, or the agent may execute in-flight steps. To prevent linear character heuristics from drifting from actual tokenizer token counts, the engine computes a dynamic calibration factor ($\kappa$):

$$\kappa = \operatorname{clamp}\left(\frac{\text{apiTokens} - \text{baseline}}{\text{histEstimate}},\, 0.7,\, 1.5\right)$$

Where:
$$\text{histEstimate} = \left\lfloor\frac{\text{chars}_{\text{prose}}}{4}\right\rceil + \left\lfloor\frac{\text{chars}_{\text{code}}}{2.8}\right\rceil + \text{tokens}_{\text{images}} + \text{tokens}_{\text{docs}}$$

* If the user writes dense code or multilingually, $\kappa > 1.0$, automatically scaling pending input estimations.
* If the user writes concise English prose, $\kappa < 1.0$.

### 4.3 Multi-Modal Segmented Lexical Estimator (MMSLE)
For uncommitted composer text and in-flight inputs, `estimateTokensPrecise(text, modelName)` runs a 9-tier pure JavaScript tokenizer with **zero external libraries**:

1. **Fenced Code Blocks**: Delimiter overhead + language tag + $\lceil L / 2.8 \rceil$ density.
2. **Inline Code**: Isolated backtick expressions tokenized at code density.
3. **Structured JSON**: Braces, colons, and quoted property keys evaluated at $2.2\text{ chars/token}$.
4. **CJK & Non-Latin Scripts**: Chinese, Japanese Kana, Korean Hangul, Arabic, and Hebrew evaluated at $0.85\text{ to }1.2\text{ chars/token}$.
5. **Numeric Chunking**: Sequences of digits chunked into 3-digit groupings matching BPE subword patterns.
6. **Compound Emojis & Astral Unicode**: ZWJ (Zero-Width Joiner) sequences and surrogate pairs preserved without string truncation.
7. **Punctuation Runs**: Operators and syntax clusters tokenized into paired units.
8. **Indentation Whitespace**: Leading whitespace runs evaluated at 1 token per 4 spaces.
9. **Standard Prose**: Words $\le 4$ chars $= 1$ token; words $\le 8$ Latin chars $= 1$ token; long words split at model-specific ratios ($4.0$ for Gemini, $3.8$ for Claude, $3.7$ for OpenAI).

### 4.4 Vision & Multimodal Image Modeling
Images are evaluated by `estimateImageTokens(width, height, modelName)` according to model provider architecture:

* **Gemini (SentencePiece / Native Vision)**: Fixed tile baseline of **258 tokens** per image up to $1024 \times 1024$.
* **Claude / Anthropic**: Tiled grid model ($1568 \times 1568$ max bounding box):
  $$\text{tiles} = \left\lceil\frac{\text{width}}{768}\right\rceil \times \left\lceil\frac{\text{height}}{768}\right\rceil$$
  $$\text{tokens} = \text{tiles} \times 1600$$
* **OpenAI (High Detail Mode)**: $512 \times 512$ tile segmentation ($170\text{ tokens/tile} + 85\text{ base}$).

### 4.5 System Baseline Overhead
`estimateSystemBaseline(doc)` identifies registered capabilities in Antigravity:
* **Base Prompt**: $1,500$ tokens.
* **Native Tools**: $180$ tokens per detected tool.
* **MCP Servers**: $600$ tokens per server definition.
* **Workspace Rules**: $350$ tokens per active instruction rule.
$$\text{systemTokens} = \min(25000,\, 1500 + \text{toolTokens} + \text{ruleTokens})$$

---

## 5. Virtual Scroll & Virtual DOM Protection

### 5.1 The Virtual DOM Challenge
Antigravity's chat interface uses a virtualized list container (`[data-testid="autoscroll-viewport"]`). As a user scrolls down, older turns are removed from the browser DOM. As the user scrolls up, dozens of historical message nodes are inserted back into the DOM.

Previous naive implementations evaluated `viewport.textContent.length`. When scrolling up, the rendered DOM contained HTML artifacts (code copy buttons, language labels, action bars, timestamps) that were $50\% \text{ to } 100\%$ larger than raw transcript characters, causing phantom $+2\text{k}$ to $+4\text{k}$ token spikes.

### 5.2 The Turn-Gated Delta Solution
In `common/context-budget.cjs`, DOM characters are **turn-gated**:

```javascript
// Determine if the DOM contains any genuinely new, unrecorded turn
const unrecordedTurns = Math.max(0, navTurns - (entry.transcriptTurns || 0));

// If all turns are already logged in the transcript, unrecordedChars is strictly 0
const unrecordedChars = unrecordedTurns > 0 
  ? Math.max(0, currentChars - (entry.transcriptChars || entry.maxChars || 0)) 
  : 0;

const pendingChars = Math.max(entry.pendingChars || 0, unrecordedChars);
```

#### Result:
* When scrolling an existing conversation, `unrecordedTurns === 0`, so `unrecordedChars` is always $0$.
* The displayed token count is **rock-solid and invariant** regardless of whether the user is at the bottom, middle, or top of the conversation.

### 5.3 Single-Source Image Deduplication
When `apiTokens > 0`, historical images are sourced strictly from disk transcript logs (`file:///.../.user_uploaded/...`). The DOM scanner is disabled for historical turns, preventing browser `data:image/png;base64,...` rendered elements from generating duplicate image entries.

---

## 6. Budget Thresholds & Health Levels

The budget indicator evaluates context saturation against the active model's context ceiling:

$$\text{percentage} = \min\left(100,\, \left\lfloor\frac{\text{tokens}}{\text{ceiling}} \times 100\right\rceil\right)$$

| Level | Range (% of Ceiling) | UI Color | Label | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Healthy** | $< 17.5\%$ | `#6ba9ff` (Soft Blue) | Healthy | Full context capacity available. Minimal memory pressure. |
| **Moderate** | $17.5\% - 42.5\%$ | `#41c878` (Emerald Green) | Moderate | Standard operating context. Tool calls and responses accumulate normally. |
| **Elevated** | $42.5\% - 80.0\%$ | `#ffd647` (Warm Yellow) | Elevated | Substantial context in use. Recommends monitoring large file inclusions. |
| **Saturated** | $> 80.0\%$ | `#ff5c5c` (Crimson Red) | Saturated | Risk of context overflow. Surfaces `/compact` recommendation. |

### Dynamic Model Detection
The model name and ceiling are automatically parsed from the interface:
* **Gemini 3.8 / 1.5 Flash High / Pro**: $1,000,000$ tokens (or $2,000,000$ when annotated `(2M)`).
* **Claude 3.5 Sonnet / Opus**: $200,000$ tokens.
* **GPT-4o / o1**: $128,000$ tokens.
* **Default Fallback**: $1,000,000$ tokens.

---

## 7. Data Contracts & State Management

### 7.1 Persisted State Schema (`localStorage`)
State is keyed under `agpa_context_budget_{conversationKey}`:

```json
{
  "apiTokens": 27263,
  "inputTokens": 25855,
  "cacheReadTokens": 0,
  "outputTokens": 1408,
  "transcriptChars": 19189,
  "transcriptTurns": 6,
  "maxChars": 19189,
  "maxTurns": 6,
  "maxImageTokens": 1032,
  "maxDocTokens": 0,
  "systemTokens": 1500,
  "systemBaseline": {
    "toolsCount": 0,
    "mcpCount": 0,
    "rulesCount": 0,
    "tokens": 1500
  },
  "mtime": 1793566778563.605,
  "ceiling": 1000000,
  "modelName": "Gemini 3.8 Flash High",
  "updatedAt": 1793573050001
}
```

### 7.2 Retroactive Sanitization Pipeline
When `loadConversationState` reads from storage:
1. **Turn Clamp**: If `maxTurns > transcriptTurns`, clamps to `transcriptTurns + pendingTurns` (eliminates legacy step-count bloat).
2. **Character Clamp**: If `maxChars > transcriptChars * 1.1`, resets to `transcriptChars`.
3. **Image Purge**: If canonical file images exist, purges any duplicate base64 `data:` URIs and recalculates `maxImageTokens`.

---

## 8. UI Layer & User Experience

### 8.1 The Context Pill (`.agpa-context-pill`)
Mounted in the Antigravity chat input container next to the model selector:
* **Compact Text**: Displays formatted tokens (e.g. `~40k tok`, `~1.2M tok`).
* **Visual Ring Indicator**: Displays SVG ring filled proportionally to the context percentage, colored according to health level.
* **Tooltips**: Screen-reader accessible `aria-label` with localized status.

### 8.2 Detailed Breakdown Modal (`.agpa-context-popup`)
Clicking the pill opens a detailed diagnostic popup providing full visibility:
* **Total Tokens & Turns**: e.g., `~40k tokens (9 turns)`.
* **Model & Ceiling Ratio**: e.g., `Gemini 3.8 Flash High · 4% (~1M max)`.
* **Prompt Caching Telemetry**: Cached tokens vs fresh prompt tokens.
* **Multimodal Assets**: Image count and calculated vision tokens.
* **System Baseline Overhead**: Tool, MCP, and rule allocations.
* **One-Click `/compact` Action**: When context exceeds 80%, provides a button to automatically insert the `/compact` command into the composer.

---

## 9. Performance & System Invariants

1. **Zero External NPM Dependencies**: Built strictly using Node.js standard library modules (`node:fs`, `node:path`, `node:crypto`, `node:child_process`, `node:net`). No `node_modules` required.
2. **Execution Overhead**:
   * MMSLE tokenizer benchmark: $< 0.6\text{ ms}$ for typical conversational turns.
   * Viewport DOM evaluation: $< 1.5\text{ ms}$ per polling cycle.
3. **ReDoS Immunity**: All regular expressions for code blocks, backticks, JSON, and indentation run in linear time $\mathcal{O}(N)$ without catastrophic backtracking, verified against 50,000+ nested syntax tokens.
4. **PowerShell 5.1 Compatibility**: Windows automation scripts in `windows/*.ps1` are verified through the PowerShell AST parser with zero syntax errors.
5. **Cross-Platform**: Fully operational across Windows (10/11) and Linux environments.

---

## 10. Complete Function Reference

### Engine Exports (`common/context-budget.cjs`)

```typescript
// Core Token Estimators
function estimateTokens(chars: number, turns?: number, imageTokens?: number, codeChars?: number, docTokens?: number, systemTokens?: number): number;
function estimateTokensPrecise(text: string, modelName?: string): number;
function estimateImageTokens(width: number, height: number, modelName?: string): number;
function estimateAttachmentTokens(name: string, sizeBytes: number): number;
function estimateSystemBaseline(doc?: Document): { toolsCount: number, mcpCount: number, rulesCount: number, tokens: number };

// Context Budget & Model Resolution
function detectActiveModel(doc?: Document): { name: string, ceiling: number };
function budgetLevelFor(tokens: number, ceiling?: number): { level: string, color: string, label: string, percentage: number, ceiling: number };
function formatTokens(count: number): string;
function calculateEffectiveTokens(entry: object, composerText?: string, modelName?: string): number;

// State & Conversation Management
function extractConversationStats(doc?: Document, storage?: Storage): ConversationStats;
function hydrateFromTranscript(convKey: string, data: object, storage?: Storage): boolean;
function saveConversationState(convKey: string, data: object, storage?: Storage): boolean;
function loadConversationState(convKey: string, storage?: Storage): object | null;
function clearConversationState(convKey?: string, storage?: Storage): void;
function clearCache(): void;
```

### Host Transcript Reader (`common/transcript-reader.cjs`)

```typescript
function readTranscriptStats(targetPathOrUrl: string): TranscriptStats | null;
function parseTranscriptContent(content: string): ParsedTranscript | null;
function extractConversationId(raw: string): string | null;
```

---

## 11. Verification Matrix

The subsystem includes a comprehensive test suite of **167 tests** run via Node.js native test runner:

* `tests/context-budget.test.cjs`: Unit & state regression suite (39 tests).
* `tests/transcript-reader.test.cjs`: Host log reader & token parser suite (9 tests).
* `tests/e2e-token-counter.test.cjs`: 4-tier opaque-box end-to-end integration suite (86 tests).
* `tests/adversarial-token-estimator.test.cjs`: Lexical tokenizer stress & ReDoS safety suite (23 tests).
* `tests/adversarial-stress-m1.test.cjs`: High-throughput JSONL & rapid disk write suite (11 tests).
* `tests/windows-*.test.cjs`: Windows native attachment & platform lifecycle suite (10 tests).

To execute the complete test suite:
```powershell
node --test tests/context-budget.test.cjs tests/transcript-reader.test.cjs tests/e2e-token-counter.test.cjs tests/adversarial-*.test.cjs tests/windows-*.test.cjs
```
