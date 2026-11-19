# rtk: what the code actually does

- Repo: https://github.com/rtk-ai/rtk · commit `6c94fc51026937ff880a5b5a0eadd4b6de71bdf1` (2026-11-17)
- Licence: CLI **Apache-2.0**; `proxy/` is **BUSL-1.1** (don't copy from it)
- Size: ~200k lines of Rust. Read: `src/discover/{mod,rules,README}.rs/md` (the history scanner), `src/analytics/cc_economics.rs` (how it prices savings), `src/analytics/gain.rs` recall verdict, `src/core/retriever.rs` + `README.md` (recovery store, TOML filter pipeline), `src/cmds/js/vitest_cmd.rs` (a typical filter), `proxy/README.md`, `proxy/src/pipeline/ingest_filter.rs` header. Not read line by line: the ~100 per-command filters (same pattern: parse → keep failures + summary), the per-agent hook installers.

## Mechanism

| What | Where | Detail |
|---|---|---|
| **PreToolUse hook rewrites the Bash command** (`git status` → `rtk git status`) | `src/discover/README.md` "How command rewriting works" | The filter runs before the output enters history, so it is cache-safe by construction |
| Guards: skip `gh --json/--jq`, `cat` with flags, writes (`>`), `RTK_DISABLED=1`, `sudo`, heredocs, substitutions | same | Structured output must not be filtered |
| Per-command filters keep failures + a summary | e.g. `src/cmds/js/vitest_cmd.rs:1` "show only failures" | Passing tests vanish |
| TOML filter DSL, 8 stages (strip ANSI → replace → match_output with `unless` so errors aren't swallowed → strip/keep lines → truncate → head/tail → max_lines → on_empty) | `src/core/README.md` | Project filters need `rtk trust` |
| **Recovery store**: full output saved (sqlite, 200 entries, 30 days, failures ≥ 500 bytes) for `rtk recall <hash>` | `src/core/retriever.rs:17-23` | The agent can pull the original back |
| **Recall-rate verdict**: recalls ÷ elisions ≥ 30 % "too aggressive", ≥ 10 % "watch", min 5 elisions | `src/analytics/gain.rs:1362-1376` | Good signal: compression the agent keeps undoing costs more than it saves |
| **`rtk discover`**: scans `~/.claude/projects/*.jsonl`, splits each Bash command chain, classifies against the rule table, sums missed savings | `src/discover/mod.rs` `run()` | Exactly a detective, but only for rtk-coverable commands |

## How it counts savings (and where that's optimistic)

- Output size = **tool_result chars ÷ 4** (`mod.rs`, `len / 4`), else a category average.
- Saving = size × a **fixed claimed % per command** from `rules.rs`: e.g. git 70, gh 82 (pr 87), cargo test 90, **jest/vitest 99**, pytest 90, go test 90, grep/rg 75, ls 65, docker/kubectl 85, npm 70.
- Money: `cc_economics.rs` prices a saved token at the **input** rate derived from weights `output 5×, cache write 1.25×, cache read 0.1×`.

Problems a detective should correct for:
1. The % are per-payload claims, not measured on your sessions. The independent JetBrains test found **+7.6 % cost** at low effort; a 500-session replay found rtk + headroom + caveman together = 3.7 % of the bill.
2. The pricing misses both directions: a token removed from a tool result saves one cache write (1.25×) plus a cache read (0.1×) on **every later turn** of that session, so late-session big outputs matter less and early ones more; but if the agent then re-runs the command or recalls the full output, the saving is negative.
3. Small outputs gain nothing: hook overhead and the "[n lines omitted]" text cost tokens too.

## What Chompyy's detective takes

1. **Symptom: big shell output.** From transcripts: per Bash command family, count runs and tool_result size (chars ÷ 4). Flag families whose output is large *and* frequent (e.g. test runners, `git log/diff`, `gh pr view`, `ls -R`, `find`, `docker logs`). Fix options, cheapest first: a flag on the command itself (`--reporter=dot`, `-q`, `--oneline`, `| tail -n 50` noted in CLAUDE.md), then rtk for that family only (`hooks.exclude_commands` for the rest).
2. **Symptom: the agent fights the filter.** If rtk is installed: same command re-run right after with different flags, `rtk recall`/`rtk bypass`/`RTK_DISABLED=1` use; recall rate ≥ 10 % watch, ≥ 30 % too aggressive → advise excluding that command.
3. **Price it per session position**, cache-aware: saved tokens × (1.25 + 0.1 × turns remaining in that session), not × input rate.
4. **Terms check**: rtk-proxy "relays routed work to cheaper models" through a local proxy in front of the API. Chompyy's rule is no relays on subscription traffic; the detective should flag an `ANTHROPIC_BASE_URL` pointing at a local proxy as "check your provider's terms", not recommend it.
5. The **rule table** (`rules.rs`) is a good, Apache-licensed list of which command families produce compressible output; reuse the families, not the % claims.
