# ponytail: what the code actually does

- Repo: https://github.com/DietrichGebert/ponytail · commit `96608e078b2d5ea607c5c3b8b5a54d1c1fba6846` (2026-10-29) · MIT
- Read: `skills/*/SKILL.md` (all 6), `hooks/ponytail-activate.js`, `-instructions.js`, `-subagent.js`, `-map.js`, `hooks/claude-codex-hooks.json`, `benchmarks/results/2026-10-07-agentic.md`. Skimmed: band/statusline (display only), per-agent plugin copies (same rules).

## Mechanism

| What | Where | Detail |
|---|---|---|
| Rules injected at **every** SessionStart (`startup\|resume\|clear\|compact`) | `hooks/claude-codex-hooks.json`, `ponytail-activate.js:43-47` | The whole SKILL.md body (3.5 kB ≈ 900 tokens), filtered to one level |
| …and into **every subagent** (SubagentStart) | `ponytail-subagent.js` | Opt-in regex `PONYTAIL_SUBAGENT_MATCHER` to limit which agents; default is all |
| **Codebase map** appended to the session start | `ponytail-map.js` | Regex over `git ls-files`, exported names per folder, 2,000-char budget (`PONYTAIL_MAP_CHARS`), shared folders first, 3 s timeout. Purpose: "reuse first" without a search |
| Output rule: reply ends with what was skipped/not checked | `SKILL.md:15` | |
| `shortcut: <limit>, <when to upgrade>` comments as a debt ledger | `SKILL.md:42`, `ponytail-debt` | Deferrals stay visible; `no-trigger` tag for markers without an upgrade path |
| The "ladder": need it? → in codebase? → stdlib? → installed dep? → one line? → minimum | `SKILL.md:25-32` | |
| Never-cut floor | `SKILL.md:44` | validation at trust boundaries, data-loss error handling, security, a11y, what the user asked for |

## Its own numbers (benchmark it publishes)

`benchmarks/results/2026-10-07-agentic.md`: Opus 5.5, default effort, 39 tasks × 5 runs × 3 arms, **Bash disabled, CLAUDE.md and memory off, fresh temp folder**. vs no skill: lines −53 %, output tokens −45 %, **cost −26 % [−36..−16]**, time −41 %, turns −22 %; hidden checks 96.7 % vs 95.6 % (level). Independent JetBrains test (earlier version): −10.3 % cost.

Caveats the code/benchmark shows:
- Bash off and no CLAUDE.md: real sessions spend much of their cost on reading and shell output, which ponytail does not touch. Expect less than −26 % on a real bill.
- The skill itself is a **fixed startup tax**: ~900 tokens + up to ~500 tokens of map at every start, resume, clear, compact, and every subagent. Cached after the first turn, but each new session/subagent pays the cache write.
- `ponytail-gain` has an explicit **honesty boundary**: never print a per-repo saving, because the unbuilt version never existed. Chompyy should follow the same rule for "less code" advice.

## What Chompyy's detective takes

1. **Symptom → advice:** sessions where the agent writes far more lines than the request implies (big Write/Edit volume on small asks, new deps added, new files for one-off helpers) → suggest the ladder (or ponytail itself). Evidence to quote: ponytail's own −26 % cost (no-Bash benchmark) and JetBrains' −10 %.
2. **Stacking check:** ponytail + caveman + another "be lean" skill all inject at SessionStart and SubagentStart. Count injected startup context per installed plugin.
3. **Subagent tax:** a plugin that injects into every subagent multiplies its cost by subagent count; check `SubagentStart` hooks.
4. **The codebase-map idea** for the "re-reads the same files / searches for what exists" symptom: a 2k-char map at session start is cheaper than repeated Glob/Grep/Read.
5. **Honesty rule:** for output-side advice, quote the benchmark, never a made-up per-repo saving; measure afterwards instead (output tokens per session before/after).
