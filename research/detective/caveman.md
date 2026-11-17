# caveman: what the code actually does

- Repo: https://github.com/JuliusBrussee/caveman · commit `9b243662ff98d392bc0a95b865a554583d71be75` (2026-11-16) · **Apache-2.0** for everything since 3.0.0 (`LICENSING.md`); Caveman Cloud is separate and not in the repo
- Size: ~1,765 files (Go engine + proxy, TS CLI, skills). The terse-reply skill is a small part. Read for the detective: `proxy/internal/store/learn.go` (sink builders, Cave Score), `learn_attribution.go`, `detect_*.go` headers and thresholds (cache hygiene in full), `source_claude.go` (transcript fields), `proxy/internal/gateway/cache_warm.go` + `cache_warm_table.go`, `proxy/CLAUDE.md` (the measured decisions), `packages/subagent-tax/METHOD.md`. Not read line by line: compressors, pixel mode, browse, routing/cloud link, TUI.

## `caveman learn`: the most complete detective of the six
"Local setup profiler": config files + real transcripts → a Cave Score and ranked **sinks** (`learn.go:21`). Class A sinks are facts; Class B are softened with their evidence. Everything is labelled `inferred`.

| Sink | Trigger (code) | Wording it uses |
|---|---|---|
| `config_tax:baseline` | always: CLAUDE.md (user + project) + skill descriptions + hooks + plugins, per turn; plus **measured prefix** = first provider-counted turn per session, and `unexplained_prefix_tokens = measured − static` | "Your always-loaded setup adds ~N tokens to every message. Much of this is needed." |
| `claude_md_weight:<scope>` | > **150 lines** or > **2,000 tokens** (`learn.go:31-32`); charged only at the turn rate of sessions that actually load that file (project files: sessions whose cwd is under it) | "Cut it down to the sections your agent actually uses. Aim for under 150 lines." |
| `context_dumbzone` | ≥ **10 %** of turns past **50 %** of the model window | "Start a fresh session, or compact, before you pass half the window. Answers get worse well before it's full." |
| `dead_load:skills` | skill description tokens for skills with no use in scanned sessions | "Not seeing a skill used doesn't prove you never need it." |
| `subagent_overuse` / `subagent_spend` | counts only; ≥ 100k tokens and ≥ 3 sessions for spend | Explicitly **never** says a spawn was unnecessary (a "standing decree" in `proxy/CLAUDE.md`) |
| `config_surface` | hooks + plugins ≥ 10 | Hooks at session start / each prompt add context |
| `mcp_tax` | ≥ 3 MCP servers | "The count alone doesn't prove any one server is unneeded" |
| cache churn (`detect_cache_hygiene.go`) | turn with cache_creation > **10k** tokens and > ¼ of context; ≥ **3** such spikes in a session; ≥ 2 sessions. Classified by Claude Code's own `message.diagnostics.cache_miss_reason.type`: `tools_changed` → invalidation; `previous_message_not_found` after the TTL elapsed → **cold resume**; else unknown | |
| compaction re-reads (`detect_compaction.go`) | files read again after compaction (≥ 2k tokens) | "Splitting work into shorter sessions, or saving progress notes before compacting" |
| whole-file re-reads (`detect_reread.go`) | ≥ 3 calls, ≥ 5k tokens | "A repeat alone doesn't prove any one re-read was unneeded" |
| tool portfolio (`detect_tool_portfolio.go`) | output volume grouped by call shape (`Read(*.lock)`, `Bash(git diff)`, `mcp__x__query`); ≥ 20k tokens, ≥ 3 calls, ≥ 5 % share, top 8 | Tool output tokens are billed on the **next** request; estimate is labelled as such |
| procedures (`detect_procedures.go`) | same 3–6-step tool sequence in ≥ 3 sessions costing ≥ 15k tokens | Only a **candidate** skill: a skill loads every session and pays back only when its pattern hits, so it goes to a holdout test, never a savings claim |
| memory health (`detect_memory_health.go`) | MEMORY.md past **200 lines / 25 KB** (Claude Code stops loading the rest), rules buried in files ≥ 150 lines, duplicate rules (≥ 6 words), broken `@imports` | |
| learning loops (`learn_loops.go`) | repeated failing/refetch calls in a session | |

Cave Score: start at 100, subtract capped penalties (config tax ≤ 35, dumbzone ≤ 25, dead load ≤ 20, subagents ≤ 20).

## How it decides a saving is real (`learn_attribution.go`, `proxy/CLAUDE.md`)
- **Provenance**: fingerprint the file the fix changed at apply time; on later scans, `intact` / `changed_since` / `target_missing`. If you edited past it, the attribution is downgraded.
- **Method rungs**, strongest first: `deterministic_remeasure` (re-count the file we changed) > `controlled_holdout` (sessions with the change on vs off) > `counterfactual_replay` (re-run scanned history with the change) > `interrupted_time_series` (before vs after; can't separate the fix from anything else that week). Totals are **never summed across rungs**. A regression is never priced. Nothing is ever called `verified`.
- **Spend is arithmetic, savings is a claim.** "Subscription traffic has no marginal cost, and every priced surface says so." Sinks are priced at the user's own measured effective input rate, so a well-cached user's findings aren't inflated ~10×.
- **Harm tripwire** (`ledger.go`): a lever earns a strike when the next request's cache_creation exceeds 50k **and** 3× the session baseline; 3 strikes freeze it for the session.
- **Masking backfires**: replacing JSON/table/log tool output with a pointer stub made the agent recover the original 27–97 times and scored 0/6 on two tasks; compress those in place instead (`proxy/CLAUDE.md`, "mask what cannot be summarized").

## Keep-warm (proxy only)
- Replays the exact last request with `max_tokens: 0` at `min(0.9 × TTL, TTL − 10 s)` so the cache doesn't expire while you pause (`cache_warm.go:66`).
- Whether to warm is **optimal stopping** over a measured return-time distribution (30-s bins to 2 h) per class `main|subagent × tool|end × 5m|1h`, from **364,048 request transitions** of real Claude Code sessions, then blended with your own gaps (prior worth 100 observations).
- Replay result on held-out data: **net $1,896.65 list-price equivalent for $385.31 of warms** (9,628 warms, 7,280 of them wasted), vs a fixed rule that netted $1,294 for $1,372 of warms.
- Only on `api.anthropic.com` through its proxy; subscription traffic "valued at list prices as plan-usage equivalent". It sends requests on its own, through a local proxy: for Chompyy that is a **terms question** (no relays, no automated keep-alive without checking), not a recommendation.

## What Chompyy's detective takes
1. Most of the sink list, with its thresholds, as the startup-tax and context chapters: config tax with **measured vs static prefix** (the unexplained gap catches hook/plugin/MCP injection nobody can see), CLAUDE.md 150 lines / 2k tokens charged only to sessions that load it, dumbzone 10 % of turns past 50 %, dead skills, MEMORY.md truncation at 200 lines / 25 KB, compaction re-reads, tool portfolio by call shape, procedures as candidates only.
2. **Cache churn from Claude Code's own diagnostics** (`cache_miss_reason`): `tools_changed` (an MCP server or tool list changed mid-session), `messages_changed`, `previous_message_not_found` after the TTL (a cold resume). On this machine: 129 × `previous_message_not_found`, 2 × `tools_changed` (61k and 166k tokens missed), 2 × `messages_changed`.
3. **The attribution ladder and its honesty rules** for step 5 ("did it work?"): name the rung, never sum rungs, never price a regression, re-check the changed file is still as we left it.
4. **Wording rules**: say what was measured, and say what it doesn't prove ("a count alone doesn't prove…"). Never claim a subagent was unnecessary.
5. **Subscription framing**: on a plan, report window % and plan-usage equivalent, never dollars saved.
6. Keep-warm stays out of Chompyy's actions (terms); its measured return-time idea is still useful for **when** to pause and for flagging cold resumes.
