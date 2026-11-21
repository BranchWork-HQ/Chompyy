# ccusage: JSONL parsing, dedupe and 5-hour blocks, from the code

- Repo: https://github.com/ryoppippi/ccusage · commit `65d3859e2c6044b4fbf9f121a33571d0e579b6c3` (2026-11-21) · **MIT** (Copyright (c) 2025 ryoppippi)
- **Now Rust** (toolchain 1.100). `apps/ccusage` is only the npm wrapper; per-platform binaries in `packages/`.
- Read: `rust/adapters/claude/src/{dedupe.rs, blocks.rs, blocks/projection.rs}`, `rust/crates/ccusage-core/src/{cost.rs, pricing/rates.rs}`, `rust/crates/ccusage-pricing-snapshots/README.md`, `rust/crates/ccusage-cli-parser/src/{parser.rs, cli-commands.json}`. Not read: other adapters, table rendering, statusline cache.

## Commands

`daily`, `weekly`, `monthly`, `session`, `blocks`, `statusline`, plus one subcommand per agent (codex, gemini, opencode, …). `blocks` options in the parser: `--active`, `--recent`, `--token-limit`, `--session-length` (`parser.rs:284-294`). **No `--live` mode** in the current Rust CLI (the old TS live dashboard is gone).

## Dedupe (`dedupe.rs`, 464 lines, many dated bug notes)

| Case | Key | Note in code |
|---|---|---|
| Normal | hash of `message.id + requestId` (`usage_dedupe_hash`) | **Matched across sessions**: Claude Code can copy one response into several transcripts (#1765) |
| No `requestId` | `message.id + sessionId + timestamp` | Gateways reuse message ids (#1799) |
| No `requestId`, blocks with different timestamps | `message.id + sessionId + response` (from the parent chain) | Each content block is a row with its own timestamp (#2255) |
| `/btw` sidechain replays | `message.id + sessionId`, across request ids | Sidechains replay parent usage with a new request id (#913) |

**Which copy wins** (`should_replace_deduped_entry`, `:448`): a non-sidechain copy beats a sidechain copy; then the copy with the **larger total tokens**; then fast-mode beats standard, then the one with `cache_creation` details, then the one with a stored cost (`reports_more_of_the_request`, `:50`).

## Pricing

- Built-in table compiled from a pinned **LiteLLM** snapshot plus a **models.dev** snapshot (`ccusage-pricing-snapshots`); no network at run time by default.
- Cost modes (`cost.rs:39-47`): `auto` (use a stored `costUSD` if the row has one, else calculate), `calculate`, `display` (stored only).
- 1h cache write rate: explicit price, else `input × write_1h_x` default (`pricing/rates.rs:100`); separate above-200k rates for 5m and 1h writes (`cost.rs:180-236`).

## 5-hour blocks (`blocks.rs`)

- Sort entries; a block starts at the **first entry's time floored to the hour** and lasts the session length (5 h).
- A new block starts when an entry is > 5 h after the block start **or** > 5 h after the previous entry (`starts_fresh_block`). Gaps become gap blocks.
- Burn rate (`projection.rs:26`): total tokens ÷ minutes between first and last entry; `tokens_per_minute_for_indicator` uses **input + output only** (no cache); cost per hour.
- Projection: current + burn × remaining minutes, for the active block. Warning at 80 % of `--token-limit`.

This is a guess at the real window (the real one is server-side). Chompyy reads the real window from the usage endpoint, so the floor-to-hour model is only a fallback for history.

## What to copy

1. **The dedupe cases as test fixtures**: every dated `NOTE(...)` in `dedupe.rs` is a real bug someone hit. Port the cases (cross-session copies, requestless gateways, sidechain replays) into Chompyy's tests even if our rule is simpler.
2. **"Larger total wins"** as the tie-break, and **"main beats sidechain"**.
3. The `auto / calculate / display` cost mode idea: show Claude Code's own cost when one exists, else our calculation, and label which.
4. Not the block model (we have the real window).
