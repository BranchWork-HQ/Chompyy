# codeburn optimize: what the code actually does

- Repo: https://github.com/getagentseal/codeburn · commit `40d58800c13422d8681862482bab02380e42582f` (same commit as our vendored quota reader) · **MIT**
- Read: `src/optimize.ts` (4,949 lines: constants, every detector's trigger, finding text, basis table), `src/act/types.ts`, `src/act/report.ts` header, `src/act/optimize-apply.ts` grep. Not read line by line: TUI, MCP schema-size estimator internals, per-provider parsers.

## The 24 checks, grouped
| Group | Finding ids | Trigger / constant |
|---|---|---|
| Startup tax | `claude-md-too-long` (healthy ≤ 200 lines, high > 400; 13 tokens/line), `unused-skills` (≥ 5 medium, ≥ 10 high), `unused-agents` (≥ 2 / ≥ 5), `unused-commands` (≥ 10), `unused-mcp` (≥ 3 high; 24 h grace for new config), `mcp-low-coverage` (≥ 10 tools, < 20 % used, ≥ 2 sessions), `mcp-project-scope` (≥ 80 % of calls in ≤ few projects), `mcp-deferral-off`, `mcp-alwaysload-hygiene` (< 0.2 calls/session), `mcp-defer-threshold`, `warmup-heavy` (median cache_creation per call over a modelled baseline; high > 15k) | |
| Reading | `build-folder-reads` (≥ 3; `node_modules`, `dist`, … ), `redundant-rereads` (≥ 5 extra reads of a path in one session, subagents excluded), `read-edit-ratio` (≥ 10 edits; healthy ≥ 4 reads per edit, < 2 high) | **600 tokens per read, flat** |
| Shell | `bash-output-cap` (default 30k chars → recommend 15k) | |
| Paste | `recurring-context` (same block pasted at the start of several sessions → put it in CLAUDE.md or a file) | |
| Sessions | `context-heavy-sessions` (input ≥ 75k and input:output ≥ 25:1, target 15:1), `low-cache-hit-sessions` (< 80 % of input from cache, ≥ 5 calls), `cost-outliers` (≥ 2× peer average, ≥ 3 sessions), `low-worth-sessions` (spend with no edits / retries / no git delivery: "a review candidate, not proof of waste"), `retry-heavy-capabilities` (≥ 50 % retry rate) | |
| Price lines | `fast-mode-background` (fast mode inside subagents nobody waits for), `long-context-premium` (calls past the long-context price threshold), `idle-compaction-blocked` | |

## Honesty already in the code
- `FINDING_BASIS` (`optimize.ts:440-470`): only `context-heavy-sessions` and `cost-outliers` are `measured`; every other saving is `estimated` (a per-unit model or a recovery fraction). Good, and Chompyy should show the same label.
- Act: backup before apply, `afterHash` checked for drift on undo (`act/types.ts`), report waits ≥ 3 days, verdict "worked" at ≥ 70 % of the promise (`VERDICT_WORKED_RATIO = 0.7`), realized figures rounded down, guard is "correlation" (`act/report.ts` header).

## Where it is weaker than the targeted tools
1. **Re-reads**: counted by path with a flat 600 tokens, even when the file was edited in between (the re-read is then needed). headroom measured byte-identical re-reads at **0.1 % of Read bytes** and removed its dedup. Chompyy: count only re-reads with no edit between, at real sizes.
2. **Shell output**: one global cap (30k → 15k chars). rtk shows the waste is per command family (test runners, `git diff`, `gh pr view`), and a global cap truncates the outputs the agent needed, causing re-fetch loops (headroom). Chompyy: per-family sizes, and check for re-fetch loops before suggesting any cap.
3. **No loops**: no error-loop or re-fetch-loop detection (headroom, caveman have it).
4. **Cache churn**: sees low hit rates but doesn't read Claude Code's own `cache_miss_reason`, so it can't tell a cold resume from a mid-session invalidation (caveman does).
5. **Output side**: nothing on verbosity or code volume (ponytail, headroom verbosity).
6. **Dollars first**: savings priced in USD; on a subscription there's no marginal cost (caveman, token-optimizer both say so).
7. **No clash detection** between installed optimizers (nobody has this).

## What Chompyy's detective takes
- The **startup-tax and MCP checks** with their thresholds and grace periods (MIT; we may copy code with credit).
- `recurring-context` (same pasted block across sessions), `long-context-premium`, `fast-mode-background`, `low-worth-sessions` wording ("a review candidate, not proof").
- The **act** design: backup, show the diff, `afterHash` drift check on undo, report after ≥ 3 days, ≥ 70 % of promise = worked, round realized down.
- The **basis label** on every finding (measured / estimated).
