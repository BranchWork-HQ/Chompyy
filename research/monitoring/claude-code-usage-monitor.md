# Claude-Code-Usage-Monitor: burn rate, P90 limits and the warehouse

- Repo: https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor · commit `c59a83bf943f329f0e61f1a29c760353ee1860a5` (2026-06-27) · **MIT** (Copyright (c) 2025 Maciej)
- Python terminal UI (Rich). Read: `src/claude_monitor/data/{reader.py, analyzer.py, warehouse.py}`, `core/{p90_calculator.py, calculations.py, plans.py, pricing.py}`.
- We already took the run-out forecast and "freeze the forecast once a limit is hit" (FEATURES §2).

## Things not taken yet

| Idea | Where | Detail |
|---|---|---|
| **Limit from your own history (P90)** | `core/p90_calculator.py:31` | Take finished 5-hour blocks that came within a threshold of a known plan limit; the 90th percentile of their totals is "your limit". Falls back to all finished blocks, then a default. Useful when no live quota is available (other agents, API users). |
| **Hourly burn across all sessions** | `core/calculations.py:94` | Tokens in the last 60 min across every block ÷ 60, not just the current block. Same as our "last hour of quota readings". |
| **Limit messages from JSONL** | `data/analyzer.py:254-410` | Finds `system` / tool-result rows that say a limit was hit (incl. Opus-specific), parses the wait time and reset. A record of *when* you actually hit limits, for history before Chompyy was installed. |
| **Warehouse** | `data/warehouse.py` | Opt-in JSON store at `~/.claude-monitor/warehouse/usage.json`, versioned schema, atomic writes, "dimensions that can survive Claude Code's source-file cleanup". Claude Code deletes transcripts after `cleanupPeriodDays` (default 30). |
| Plans | `core/plans.py` | Pro 18 $ / 250 msgs, Max5 35 $ / 1,000, Max20 140 $ / 2,000 per block: rough, old guesses. Don't copy. |

## Weak spots

- **Dedupe keeps the first row** (`reader.py:263`: key `message_id:requestId`, first seen wins; rows without both are not deduped). On this Mac the first row and the last row agree in all but 9 of 4,102 repeated ids, so the error is tiny today; in those 9 the last row had the larger `output_tokens`, which "first wins" drops (not checked on older Claude Code versions).
- **Pricing**: hard-coded table, cache write 1.25×, read 0.1× (`pricing.py:30`), **no 1-hour cache write price**. On this Mac 94 % of cache-write tokens are 1-hour writes (2× input), so this under-prices cache-write cost by ~36 %.

## What to copy

1. The **warehouse idea**: Chompyy should keep its own per-turn ledger (`~/.chompyy/usage/…`) so history outlives Claude Code's cleanup.
2. **Limit-hit rows from JSONL** as history for the premise number ("how often did you hit the wall") before Chompyy existed.
3. **P90 personal limit** only as a fallback for providers without a quota reader.
