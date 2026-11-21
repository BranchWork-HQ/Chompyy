# What Claude Code's JSONL holds on this Mac (counts only)

- Checked 2026-11-21, read-only, no message text printed. Script: a throwaway `python3 -I` reader in the session scratchpad (not committed).
- Scope: `~/.claude/projects/*/*.jsonl` (580 files) + `*/*/subagents/*.jsonl` (15 files). Oldest file 33.7 days; `cleanupPeriodDays` is 365 in `~/.claude/settings.json`.
- Models seen: `claude-opus-5-5` 10,207 rows, `claude-haiku-5-5` 1,759, `claude-sonnet-5-5` 241, `<synthetic>` 9.

## Assistant rows

| Field | Rows with it (of 12,216) |
|---|---|
| `message.id` | 12,216 |
| `requestId` | 12,207 (the 9 without are `<synthetic>` error rows) |
| `message.usage` | 12,216 |
| `sessionId`, `uuid`, `parentUuid`, `isSidechain`, `timestamp`, `cwd`, `gitBranch`, `version` | 12,216 |
| `requestRef`, `requestedModel`, `effort`, `advisorModel`, `apiBlockIndex` | 12,207 |
| `agentId` (subagent rows) | 687 |
| `attributionSkill` / `attributionPlugin` / `attributionMcpServer` / `attributionAgent` | 736 / 345 / 292 / 675 |
| `thinkingDurationMs`, `toolInputStreamMs` | 4,144 / 1,986 |
| **any cost field** (`costUSD` on the row, the message or the usage) | **0** |

`message.usage` keys: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `cache_creation` {`ephemeral_5m_input_tokens`, `ephemeral_1h_input_tokens`} (all rows), `output_tokens_details` {`thinking_tokens`}, `server_tool_use` {`web_search_requests`, `web_fetch_requests`}, `iterations` (all type `message` here), `service_tier`, `speed`, `inference_geo`, `fallback_credit`.

**Cache writes: 41.2 M tokens at 1 hour vs 2.8 M at 5 minutes (94 % 1-hour).** Pricing the 1-hour write at 2 × input, not 1.25 ×, is not a detail here.

## Streaming duplicates

| | Count |
|---|---|
| Unique `message.id` | 5,948 |
| Rows per id: 1 / 2 / 3 / 4 / 5 / 6+ | 1,846 / 2,482 / 1,307 / 191 / 69 / 53 |
| Ids that repeat | 4,102 (6,268 extra rows) |
| Repeats whose usage differs between rows | **9** (in all 9 the last row has the larger `output_tokens`) |
| Repeats spanning more than one file | 0 |
| Repeats with more than one `requestId` | 0 |

Total tokens if you keep the first row: 842,386,155 · keep the last (= keep the max): 842,413,436 · **naive sum of every row: 1,812,696,704 (2.15 × too much)**.

So: today each content block is its own row carrying the **same** final usage. Dedupe by `message.id` is essential; which copy you keep barely matters now, but **keep the last / the largest** to be safe. `(message.id, requestId)` gives the same groups here.

## Other row types worth knowing

| Type | Rows | Keys (no values read) | Use |
|---|---|---|---|
| `api-request` | 6,190 | `id`, `timestamp`, `querySource`, `params` {`model`, `betas`, `max_tokens`, `thinking`, `context_management`, `output_config`}, `cacheControl`, `shapeHash`, `requestDigest`, `keep`, `tail`, `base`, `agentId` | Per-request metadata; assistant rows point to it via `requestRef` (12,225 of 12,229 refs match an `api-request` id). `querySource` tells main vs side queries |
| `api-request-blob` | 6,743 | `hash`, `message`, `agentId` | Request bodies by hash; never read for cost |
| `pr-link` | 2,025 | `prNumber`, `prUrl`, `prRepository` | Spend per PR (codeburn's Yield) |
| `ai-title` | 2,621 | `aiTitle` | Conversation title for the trace list |
| `attachment`, `system`, `mode`, `permission-mode`, `queue-operation`, `file-history-snapshot`, `last-prompt`, `atis-latch`, `session-owner` | | | Turn boundaries (queued prompts are attachments), compactions, mode changes |
