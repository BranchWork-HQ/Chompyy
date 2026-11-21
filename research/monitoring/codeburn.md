# codeburn: spend tracking, the session "why" view and the menu bar, from the code

- Repo: https://github.com/getagentseal/codeburn · commit `c08d761087afe8aaf132777f58326a6e7fecc7ef` (2026-11-20) · **MIT** (Copyright (c) 2026 AgentSeal)
- Earlier note on its optimize checks: [../detective/codeburn.md](../detective/codeburn.md) (commit `40d5880`). Not redone here.
- Read: `src/parser.ts` (Claude parse, dedupe, turns: lines 1338–1860), `src/models.ts` (pricing, `calculateCost`), `src/session-why.ts` (per-session trace), `src/day-aggregator.ts`, `src/menubar-json.ts` (types), `app/renderer/lib/story.ts` + `sections/SessionView.tsx` header, `mac/Sources/CodeBurnMenubar/{RefreshCadence.swift, Data/DataClient.swift, Views/HeatmapSection.swift, Views/AgentTabStrip.swift}`. Not read line by line: the 48 other provider readers, the TUI, sync/sharing.

## Parsing `~/.claude/projects` JSONL

| Step | Where | Rule |
|---|---|---|
| Streaming duplicates | `parser.ts:1718` `dedupeStreamingMessageIds` | Group rows by `message.id`. **Keep the last row** (authoritative usage), give it the **first row's timestamp**, and put back `tool_use` blocks that only earlier rows had (`withEarlierToolUses`, matched by block id). Claude Code writes one row per content block. |
| Across files | `parser.ts:1847` `groupIntoTurns` | One global `seenMsgIds` set: a `message.id` already counted in another file (resume, fork) is skipped. No `requestId` in the key. |
| Fallback key | `parser.ts:1637` | `msg.id ?? "claude:" + timestamp` |
| Tokens | `parser.ts:1544` `parseApiCall` | `input_tokens`, `output_tokens`, `cache_read_input_tokens`, cache writes from `cache_creation.ephemeral_5m/1h_input_tokens` (falls back to the flat total; keeps the larger), `output_tokens_details.thinking_tokens`, `server_tool_use.web_search_requests`, `usage.speed` |
| Advisor calls | `parser.ts:1655` `parseAdvisorCalls` | `usage.iterations[]` of type `advisor_message` are priced as separate calls under the advisor's model (excluded from the top-level usage) |
| Turns | `groupIntoTurns` | A turn starts at a user row with text (or a queued prompt attachment); it holds every assistant call until the next one. Turns with no calls are dropped. Carries `gitBranch`, PR links, subagent spawn ids. |

## Pricing

- Source: **LiteLLM** `model_prices_and_context_window.json` (`models.ts:97`), fetched live and cached **24 h** (`CACHE_TTL_MS`), with a **bundled snapshot** `src/data/litellm-snapshot.json` as the offline fallback, plus a small override table for models LiteLLM gets wrong.
- Missing cache prices: write = **1.25 × input**, read = **0.1 × input** (`buildCosts`, `models.ts:144`).
- **1-hour cache writes = 1.6 × the 5-minute write rate** (`ONE_HOUR_CACHE_WRITE_MULTIPLIER_FROM_FIVE_MINUTE_RATE`, `models.ts:117`), i.e. 2 × input.
- Long-context tier (`*_above_200k_tokens`) applied when input + cache read + cache write passes the threshold; fast mode multiplier from LiteLLM `provider_specific_entry.fast`.
- Unknown model → $0 and one warning (`calculateCost`, `models.ts:1586`).

## Aggregation

- `DailyEntry` per local date (`day-aggregator.ts`): cost, calls, sessions, the four token kinds, edit turns, one-shot turns, per-model, per-category, per-provider. Cached per day on disk (`daily-cache.ts`).
- `PeriodData` (`menubar-json.ts:8`): the same totals for a period plus categories and models; `DailyHistoryEntry` with top models per day feeds the charts.
- Also by project, branch (`branch-spend.ts`), PR (`yield.ts`), model.

## Pillar A already exists here: `codeburn sessions --id <id> --why`

`src/session-why.ts` (1,107 lines; Claude Code sessions only, `main.ts:3193`). It reuses the parser's dedupe and turn grouping, so totals match the session list. Transcript text is redacted, capped and never cached.

| Level | Type | What it holds |
|---|---|---|
| Session | `SessionWhy` | title, project, start/end, cost, calls, findings, turns |
| Turn (one prompt) | `WhyTurn` | prompt kind (`text`/`pasted`/`system`), cost, **`parts`** (USD by input / output / cacheRead / cacheWrite / webSearch), tokens, models, helper (subagent) cost, wall time, steps |
| Step | `WhyStep` `kind:'model'` | start/end ms, model, cost, **basis** (`recorded`/`calculated`/`estimated`/`included`/`unpriced`), parts, tokens, `startedBy` (prompt/tool/message), cached %, tool calls |
| Step | `WhyStep` `kind:'tool'` | name, label, `isError` + parsed error (exit code, cause), parent model step, parallel index, **`resultChars`** |
| Subagent | `WhyAgent` | own steps, parts, tokens, delegated/handed-back times, task and report size estimates, hand-back cost |

Findings it attaches to a turn or step (`WHY_RULES`, `session-why.ts:27`): `hotspot` (turn ≥ 20 % of the session and ≥ 2× median), `helpers` (subagents ≥ 10 %), `coordination`, `reread`, `failed` tool, **`carry`** (a tool result or paste ≥ 10k tokens, priced as one cache write plus a cache read on **every later call until the next compaction**, `session-why.ts:845`), **`prefix`** (startup context ≥ 40k tokens and what re-reading it cost), `idle` (≥ 60 s), `slowCall` (≥ 60 s).

The Electron view (`app/renderer/sections/SessionView.tsx`, `lib/story.ts`) turns this into a story: requests with their tools, durations, `context = input + cacheRead + cacheWrite` per request, "added = resultChars ÷ 4".

## Menu bar (Swift, `mac/`) and charts

- The Swift app spawns the TS CLI: `codeburn status --format menubar-json --provider X --period Y` (`DataClient.swift:118`). Same split as Chompyy (Swift UI asks the TS core).
- Refresh (`RefreshCadence.swift`): popover open **30 s**; closed on AC **120 s**, battery **150 s**, Low Power **300 s**; fixed 1/5/15 min or manual. Each fetch is a full Node process, hence the backoff.
- Provider switcher: `AgentTabStrip.swift`, a horizontal tab strip with paging chevrons.
- Insight pills (`HeatmapSection.swift`): **Plan** (live quota, per provider), **Trend** (14-day bar chart with peak + average, metric toggle), **Calendar** (GitHub-style contribution heatmap), **Forecast**, **Pulse** (tiles + cost per edit), **Stats** (top projects, retry tax), **Optimize**. Also `SparklineView.swift`, `ModelsSection`, `ActivitySection`, `CapacityDockView` (screen-edge rings). Charts are hand-drawn SwiftUI, **no Swift Charts**; macOS 14 floor.
- Electron charts (`app/renderer/components/`): `StackedBars`, `ActivityHeatmap`, `Punchcard` (weekday × hour), `Sankey` (spend flow), `BranchBreakdown`.

## What to copy

1. **The dedupe**: last row per `message.id`, first timestamp, restore earlier `tool_use` blocks, one global seen-set across files. (MIT, `parser.ts:1718-1784`.)
2. **The `WhyTurn` / `WhyStep` shape and `carry` / `prefix` pricing** as Chompyy's per-conversation trace model.
3. **Pricing**: LiteLLM with a bundled snapshot and 24 h cache; 1h cache write = 2 × input; long-context tier.
4. **Cost basis label** on every number (`recorded` / `calculated` / `estimated`).
5. Menu bar: the insight pill switcher and the refresh backoff numbers; the Punchcard for "when do you use Claude".
