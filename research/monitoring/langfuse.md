# Langfuse: the trace model and trace view (and who already maps Claude Code into it)

- Repo: https://github.com/langfuse/langfuse · commit `4afc77978b844de865398c8e4f5af93c4b53e301` (2026-11-20) · **MIT** outside `ee/`, `web/src/ee/`, `worker/src/ee/`, `packages/shared/src/server/ee/` (those are under `ee/LICENSE`). Server product; we take the model and the view idea only.
- Read: `packages/shared/src/domain/{observations.ts, traces.ts}`, `packages/shared/src/server/ingestion/types.ts:117-151` (Anthropic cache keys), `web/src/features/traces/types/treeNode.ts`, `web/src/features/traces/fns/treeBuilding.ts:250-300`, `web/src/features/traces/components/{TraceTimelineDense/TimelineRowMetrics.tsx, BreakdownTooltip.tsx}`, component list.

## Data model

```
Session (sessionId)            ← many traces
 └─ Trace (id, name, timestamp, sessionId, userId, tags)
     └─ Observation tree (parentObservationId)
         type: SPAN | GENERATION | TOOL | AGENT | EVENT | CHAIN | …
         startTime, endTime, completionStartTime (→ timeToFirstToken), latency
         model, level (DEBUG/DEFAULT/WARNING/ERROR), statusMessage
         usageDetails  {input, output, cache_read_input_tokens, input_cache_creation_5m, input_cache_creation_1h, …}
         costDetails   {same keys, USD}
         providedUsageDetails / providedCostDetails  (as sent) vs calculated
         totalCost, inputCost, outputCost, toolCalls, toolCallNames
```

- `usageDetails` and `costDetails` are **open maps**, not fixed columns, so any provider's token kinds fit. Anthropic cache writes are split into `input_cache_creation_5m` / `_1h` because they're priced differently; the flat `cache_creation_input_tokens` keeps only the unattributed remainder so nothing is priced twice (`ingestion/types.ts:117`).
- **Provided vs calculated** cost is kept apart and shown (`BreakdownTooltip.tsx`: `costSource: "calculated" | "provided"`, plus which price tier).

## Trace view

| Piece | What it does | File |
|---|---|---|
| Tree | Each node shows its own cost and **subtree cost**, computed bottom-up while building the tree (`totalCost` on `TreeNode`), plus subtree wall-clock time so async children that outlive the parent aren't hidden | `types/treeNode.ts`, `fns/treeBuilding.ts:250` |
| Timeline | Gantt bars by start offset; beside each bar **duration first, then cost**, dropped if it doesn't fit. Heat-map colouring was tried and removed: colour already means observation type | `TraceTimelineDense/TimelineRowMetrics.tsx` header |
| Breakdown tooltip | Token and cost per key, cache hit rate = cache read ÷ all input, refuses to show a rate when keys overlap or totals don't add up | `BreakdownTooltip.tsx:399-440` |
| Also | Log view (flat), graph view (agent graph), messages view, session view across traces | `components/TraceLogView`, `TraceGraphView`, `TraceMessagesView` |

## Who already maps Claude Code into Langfuse

1. **langfuse/Claude-Observability-Plugin** · commit `b1619f994240ad49de4a97caa01d7d7853944fc0` (2026-10-26) · **MIT** (Langfuse GmbH). Read `hooks/hooks.json`, `hooks/langfuse_hook.py` (3,570 lines).
   - Runs on Claude Code's **Stop** and **SessionEnd** hooks; reads only new bytes of the transcript since the last run (`read_new_jsonl`, byte offset + partial-line buffer, `:861`).
   - **One Langfuse trace per user turn**, grouped by Claude Code `sessionId` (`emit_turn`, `:3196`). A turn is only emitted once the next user row proves it closed.
   - Assistant rows **merged by `message.id`** (content blocks concatenated, last message wins), tool results deduped by `tool_use_id`, latest wins (`assemble_turns`, `:1414`).
   - Each merged assistant message → a `generation` with `usage_details` {input, output, cache_read_input_tokens, input_cache_creation_5m/1h} (`:695`); each tool use → a `tool` observation; subagents → nested spans from `subagents/*.jsonl`. Cost is computed by the Langfuse server from its model prices.
2. kaiser-data/claude-code-langfuse-tracing and the PyPI `claude-code-langfuse-hook`: same Stop-hook replay (the first vendors the Langfuse hook). Not read.
3. Claude Code's own OpenTelemetry **traces (beta)** give the same tree natively: `claude_code.interaction` → `llm_request` / `tool`. See [claude-code-otel.md](claude-code-otel.md). A Langfuse discussion notes the stable OTel export is logs, not traces, which is why the hook exists.

## What Chompyy takes

1. **The tree**: conversation (session) → turn (one prompt = Langfuse trace) → request (GENERATION) → tool (TOOL) → subagent (AGENT, its own subtree).
2. **Open-map usage/cost with 5m/1h cache split** and **provided vs calculated** labels.
3. **Subtree cost computed bottom-up**; each row shows duration then cost; no heat colours on the timeline.
4. The plugin's **incremental read** (byte offset + partial-line buffer) for keeping Chompyy's ledger current without re-reading files.
