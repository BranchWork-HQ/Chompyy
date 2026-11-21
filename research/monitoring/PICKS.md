# Monitoring picks: what Chompyy copies for the per-conversation trace (A) and the menu bar (B)

Read 2026-11-21, code not READMEs. One note per tool in this folder; the optimisation detectors stay in [../detective/RULEBOOK.md](../detective/RULEBOOK.md).

## The short answer

- **Pillar A is mostly built already, in codeburn** (MIT, TypeScript). `codeburn sessions --id <id> --why` (`src/session-why.ts`) is a Langfuse-like trace of one Claude Code conversation: turn → model request → tool step → subagent, each with cost split by token kind and findings pinned to the turn or step. Copy its parser dedupe, its turn grouping and its `WhyTurn` / `WhyStep` shape into Chompyy's TS core, and lay it out the way Langfuse does (tree with subtree cost + timeline).
- **Dedupe rule**: group assistant rows by `message.id` (with `requestId` when present), keep the **last / largest** row, one seen-set across all files. On this Mac a naive sum counts **2.15 ×** the real tokens; which copy you keep changes the total by 0.003 %.
- **Pricing**: no cost field exists in the JSONL (0 of 12,216 rows). Use **LiteLLM with a bundled snapshot** (codeburn's way), **1-hour cache writes at 2 × input** (94 % of cache writes here are 1-hour), and label every number `calculated`. For away runs keep Claude Code's own `total_cost_usd` and label it `recorded`.
- **Pillar B**: port **CodexBar's** quota burndown with the even-use line, adaptive refresh and merged-icon switcher; **codeburn's** insight pills (Plan / Trend / Calendar / Forecast) and refresh backoff; **AgentLimits'** quartile calendar heatmap. All MIT, all SwiftUI.
- **Correction**: AgentLimits' heatmap is a GitHub-style **daily calendar**, not weekday × hour. The weekday × hour grid for "propose away windows" comes from codeburn's `Punchcard.tsx` (idea) drawn in Swift.
- **First-party bonus**: Claude Code's OpenTelemetry `api_request` event carries `cost_usd`, tokens incl. 5m/1h cache and `request_id`; the beta trace has `ttft_ms` and tool `result_tokens`. Free to turn on for away runs (Chompyy sets the env); opt-in for everyday sessions.

```
 ~/.claude/projects/**/*.jsonl ──► dedupe (message.id[+requestId], keep largest) ──► price (LiteLLM snapshot, 1h=2×)
           │                                                                         │
           └─► ~/.chompyy/usage ledger (per request, survives cleanup) ◄──────────────┘
                     │                                        ▲
     ┌───────────────┴──────────────┐                 away runs: stream-json result (recorded)
     ▼                              ▼                 + optional OTel api_request (recorded, per request)
 A. Trace view                  B. Menu bar
 conversation → turn →          Plan bars + burndown (even-use line) · Trend 14 d · Calendar heatmap
 request → tool / subagent      Forecast "resets unused at 18:20" · provider switcher · tokens sparkline
```

## Pillar A: per-conversation trace

| Pick | From (file) | Licence | Notes |
|---|---|---|---|
| **Data model**: Conversation → Turn (one prompt) → Request (GENERATION) → Tool step (TOOL) → Subagent (AGENT, own subtree) | codeburn `src/session-why.ts:44-100` (`WhyTurn`, `WhyStep`, `WhyAgent`); Langfuse `packages/shared/src/domain/observations.ts` | MIT / MIT (non-ee) | Turn = Langfuse trace, conversation = Langfuse session |
| Usage/cost as **open maps** with `cache_creation_5m` / `_1h` split; **parts** = USD per token kind | Langfuse `server/ingestion/types.ts:117`; codeburn `WhyParts` | MIT | Lets Codex and others fit later |
| **Dedupe**: last row per `message.id`, first row's timestamp, restore earlier `tool_use` blocks, global seen-set | codeburn `src/parser.ts:1718-1784, 1847` | MIT | Tie-break: main beats sidechain, larger total wins (ccusage `dedupe.rs:448`) |
| Dedupe **test cases**: cross-session copies, requestless gateways, `/btw` sidechain replays, per-block timestamps | ccusage `rust/adapters/claude/src/dedupe.rs` (dated `NOTE`s) | MIT | Port as fixtures, not code (Rust) |
| **Turn boundaries**: user row with text or queued-prompt attachment; drop turns with no calls | codeburn `groupIntoTurns` `parser.ts:1785` | MIT | Langfuse plugin waits for the next user row before closing a turn |
| **Advisor** iterations priced as separate calls | codeburn `parseAdvisorCalls` `parser.ts:1655` | MIT | |
| **Pricing**: LiteLLM, 24 h cache, bundled snapshot, overrides; 1h write = 1.6 × 5m rate; long-context tier | codeburn `src/models.ts:97-180, 1572` | MIT | ccusage and sniffly also use LiteLLM; CodexBar uses models.dev |
| **Cost basis** label: recorded / calculated / estimated / unpriced | codeburn `CostBasis`; Langfuse provided vs calculated | MIT | Same honesty rule as the detective |
| **What ate the tokens** per turn: `carry` (big tool result or paste × every later call until compaction), `prefix` (startup context re-read), `hotspot`, `helpers`, `failed`, `idle`, `slowCall` | codeburn `session-why.ts:27-40, 780-900` | MIT | These are where detective findings attach in the view |
| Tool error badges by category | sniffly `core/constants.py:25-75` | MIT | Port the regexes |
| Interruption rate per conversation | sniffly `core/stats.py:576` | MIT | Also a taste signal |
| **Incremental read**: byte offset + partial-line buffer per file | Langfuse plugin `hooks/langfuse_hook.py:861` | MIT | Keeps the ledger fresh cheaply |
| Own **ledger** that outlives Claude Code cleanup | Claude-Code-Usage-Monitor `data/warehouse.py` | MIT | Idea only |

**What the trace view shows** (Langfuse layout, codeburn content):
1. Conversation header: title (`ai-title` row), project, branch, PRs (`pr-link`), total tokens, cost at API prices with basis, cache hit %, duration.
2. **Tree**: one row per turn (prompt kind, not text by default), expandable to requests and tools; each row shows **own cost and subtree cost** (bottom-up, Langfuse `treeBuilding.ts:250`) and a small parts bar (output / cache read / cache write / input).
3. **Timeline**: bars by start offset; beside each bar duration first, then cost; no heat colours (Langfuse removed them, `TimelineRowMetrics.tsx`).
4. **Context line** per request: `input + cacheRead + cacheWrite` (codeburn `story.ts`), so you see the context grow and drop at compactions.
5. **Findings pinned in place**: a `carry` badge on the tool step that brought in 40k tokens, with "cost it caused later: $X over N calls"; detective findings (RULEBOOK) shown on the turn or step they came from, each with its basis label.
6. Subscription users see tokens and "% of your 5-hour window" first, dollars as "API value" second (token-optimizer rule).

## Pillar B: menu bar and graphs

| View | Port from (file) | Licence | Notes |
|---|---|---|---|
| **Plan bars**: 5 h, weekly, per-model weekly, with reset time | CodexBar `Menu/UsageProgressBar.swift`, `MenuCardView*.swift` | MIT | Data already in `chompyy state` |
| **Even-pace marker** on the bars | AgentLimits pacemaker; CodexBar `UsagePace.swift` | MIT | Our stay-on-pace rule, visible |
| **Quota burndown** + ideal line, restart after reset | CodexBar `QuotaBurndownModel.swift` (74 lines) + `QuotaBurndownChartMenuView.swift` | MIT | Feed from `~/.chompyy/quota-history.json` |
| **Forecast**: "~40 % resets unused at 18:20" / "limit ~20:24" | Chompyy's own (FEATURES §2) | — | Drawn as the burndown's projected tail |
| **Trend**: 14-day bars with peak + average, metric toggle (tokens / API value) | codeburn `Views/HeatmapSection.swift:136-600` `TrendInsight` | MIT | Hand-drawn SwiftUI, macOS 14 |
| **Calendar heatmap**: quartile levels, 5 colours, Mon/Wed/Fri labels | AgentLimits `HeatmapLevelResolver.swift`, `HeatmapColors.swift`, `HeatmapView.swift` | MIT | Also codeburn `ContributionHeatmapInsight` |
| **Weekday × hour grid** (when you use Claude → away windows) | codeburn `app/renderer/components/Punchcard.tsx` (idea); sniffly hourly | MIT | Draw in Swift |
| Insight **pill switcher** (Plan / Trend / Calendar / Forecast / Conversations) | codeburn `HeatmapSection.swift:105` `InsightPillSwitcher` | MIT | |
| **Provider switcher**: merged icon, switcher or stacked | CodexBar `MergedIconPresentation.swift`, `Menu/ProviderSwitcherButtons.swift`; codeburn `AgentTabStrip.swift` | MIT | Claude first; Codex when its reader lands |
| Tokens **sparkline** in the menu bar, peak per column | CodexBar `Menu/MenuBarTokensSparkline.swift` | MIT | |
| **Refresh**: 2 min after menu use, 5 min warm/coding, 15 min idle, 30 min long idle or low power; refresh on open | CodexBar `AdaptiveRefreshCore/AdaptiveRefreshPolicyCore.swift:53-63` | MIT | Today Chompyy polls every 15 s (`Store.swift:23`); spend scans should back off like codeburn (30 s open / 120 s closed) |
| Once-per-boundary **notifications** (reset unused soon, limit reset) | CodexBar `LimitResetNotifications.swift`, `PredictivePaceWarnings.swift` | MIT | Wording flipped to Chompyy's trigger |
| **Conversations list** → opens the trace view (A) | codeburn `sections/Sessions.tsx` → `SessionView.tsx` | MIT | Sorted by cost or by % of window |

## How Chompyy's existing pieces fit

| Existing piece | Where | Role in the new pillars |
|---|---|---|
| Exact tokens per away run from the stream-json `result` event | `cli/src/tokens.ts`, `runner.ts` | The **recorded** cost for away runs; the check on our JSONL pricing (same run, both ways, should agree within a few %) |
| Quota reader (usage endpoint, status-line fallback) | `cli/src/livequota.ts`, `vendor/codeburn/claude.ts`, `quota.ts` | Plan bars, burndown samples, per-model weekly bars |
| 5-hour forecast | `cli/src/pacing.ts` / `quota-history.json` | Forecast pill and the burndown tail |
| Dream reader of `~/.claude/projects` | `cli/src/dream.ts`, `history.ts` | Already walks the same files and picks workspaces; the usage parser should share its file walk and workspace choice, but read only usage and structure, not text |
| Cost ranges per card | `cli/src/costs.ts` | Later fed by per-run tokens instead of quota deltas |
| Swift app runs `chompyy state` | `mac/Sources/Chompyy/Store.swift`, `CLI.swift` | Same pattern as codeburn's `menubar-json`; add `chompyy usage --json` (daily, trend, conversations) and `chompyy trace <session> --json` |

New TS pieces: `usage/parse.ts` (codeburn dedupe + turns), `usage/price.ts` (LiteLLM snapshot), `usage/ledger.ts` (incremental, survives cleanup), `trace.ts` (codeburn `session-why` subset). Vendored under `cli/src/vendor/codeburn/` with `UPSTREAM.md`, like the quota reader.

## Open questions

1. **Copy `session-why.ts` whole** (1,107 lines, Claude only) or a subset (turns, steps, parts, `carry`, `prefix`)? Subset keeps the monthly diff small.
2. **Bundle LiteLLM only**, or also fetch daily? Fetching means a network call from a local tool; the snapshot goes stale for new models (unknown model = $0 + warning).
3. **OTel for everyday sessions**: worth asking users to set env vars and run a local receiver for `cost_usd` and `ttft_ms`? Or only for away runs, where it's free?
4. **Ledger retention**: keep per-request rows forever (small: numbers only) or roll up to per-turn after 30 days?
5. **Codex next?** CodexBar and codeburn both read Codex; the trace model is open-map so it fits, but turn boundaries differ.
6. **AgentLimits' wake-up** (start a window on purpose at a chosen hour): useful for "be ready when I sit down", opposite of our never-probe rule. Terms check first; not planned.
7. **Swift Charts or hand-drawn?** CodexBar uses Swift Charts, codeburn draws by hand. Both work on macOS 14; Swift Charts is less code for the burndown.
