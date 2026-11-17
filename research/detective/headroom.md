# headroom: what the code actually does

- Repo: https://github.com/headroomlabs-ai/headroom · commit `18067b1d19f6606bae3b4d6b50efeeaa48dc477e` (2026-11-16) · **Apache-2.0**
- Size: ~280k lines (Python + Rust crates + plugins). Most of it is a **proxy** that rewrites API traffic (handlers, streaming, compressors). Read for the detective: `headroom/learn/{analyzer,loops,verbosity,models}.py`, `headroom/audit/reads.py`, `headroom/cache_economics.py`, headers of `cache/{prefix_tracker,dynamic_detector,ttl_estimator}.py`, `learn/writer.py`. Not read line by line: proxy handlers, compressors (kompress, smart_crusher, code_compressor), memory backends, dashboards, SDKs.

## The detective-shaped parts

### 1. `headroom learn` (transcripts → CLAUDE.md rules)
- **Pipeline**: scan sessions → digest (≤ 80k tokens, halves on "prompt too long" down to 10k) → **one LLM call** → JSON rules → written between `<!-- headroom:learn:start/end -->` markers (`analyzer.py`, `writer.py`).
- **Priority order in its prompt** (`analyzer.py` `_SYSTEM_PROMPT`): 1 loops, 2 environment rules ("use `uv run python`, not `python3`"), 3 file-structure facts (large files, right paths, search scopes), 4 user preferences/corrections, 5 failure patterns, 6 workflow rules, 7 waste hotspots.
- **Evidence bar**: 2+ occurrences or explicit user direction; no one-off rules; no tautologies. Rules carry `estimated_tokens_saved` + `evidence_count`.
- **Prior rules are the baseline**: re-emitting a section replaces it whole; keep accurate bullets, drop only on contradicting evidence. (Same as TokenEconomizer's governance.)
- **Safe headless call** (`analyzer.py` `_CLI_BACKENDS`): `claude -p --tools "" --strict-mcp-config --settings '{"disableAllHooks":true}'`. Why each flag: `--tools ""` alone leaves MCP tools; a plugin's blocking **Stop hook** forces a second turn whose reply replaces the answer. Chompyy's own headless calls need the same flags.

### 2. Loop detection (`learn/loops.py`): measured, not guessed
- **Error loop**: same call fails, retried. **Re-fetch loop**: output was truncated (`| head -50`), agent re-runs variants (`head -100`, new offset). Each call succeeds, so failure-only analysis misses it.
- Signature: identity fields per tool (Bash `command`; Read `file_path`; Grep/Glob `pattern`+`path`), pagination fragments (`| head -n N`, `| tail`, `-n N`, `--max-count`, `LIMIT/OFFSET`) stripped, bare integers → `N`, lower-cased.
- Grouped **within a session**; **≥ 3** repeats = loop; waste = output bytes ÷ 4 of the N−1 redundant calls; de-duplicated by `tool_call_id` (resumed sessions replay earlier turns).
- Loop rules are ranked above one-off rules because their waste scales with repetition.

### 3. Verbosity from behaviour (`learn/verbosity.py`)
- People rarely say "be brief"; they **show** it: interrupts (`[Request interrupted by user`) and **fast skips** (reply arrives in < 50 % of the time a 250-wpm reader needs, answers ≥ 150 words).
- `pressure = interrupt rate + fast-skip rate`; < 10 human turns → no call. < 0.10 L1 (light touch), < 0.30 L2 (drop ceremony and echo), < 0.55 L3 (conclusions only), else L3 capped (never auto-applies caveman's L4).
- Same pass builds a per-stratum output-token baseline (turn kind × input size × model × tools) to **measure** the effect later.

### 4. Read audit (`audit/reads.py`): size the opportunity before building the fix
- Per Read: identical repeat, subset of an earlier full read, write-readback (reading back what it just wrote), stale (file edited later), `cat -n` line-number overhead, **context residency** (turns a read stays in context = multiplier on cache-read cost), **cache-death windows** (gaps > 5 min / > 1 h).
- **Key measured result** (`reads.py` docstring): a dedup mechanism for identical re-reads was built and **removed: 0.1 % of Read bytes** on real traffic. Re-reads look wasteful but are rarely byte-identical, and usually come after an edit.

### 5. Cache rules (`cache/prefix_tracker.py`, `dynamic_detector.py`, `ttl_estimator.py`, `cache_economics.py`)
- Anthropic: read 0.1×, write 1.25×, 5-min TTL. Modifying already-cached messages turns a 90 % read discount into a 25 % write surcharge, so **freeze what the provider already cached; only touch new content**.
- Dynamic content (dates, times, UUIDs, request ids, versions, session ids, high-entropy strings) early in a prompt breaks the prefix; move it to the end.
- TTL is learned conservatively: overestimating only loses savings, underestimating busts a warm cache.

## Its own number
Replay on a real bill: 2.8 % saved (from our landscape notes). The architecture explains why: compression only touches new tool output, which is a minority of a cache-dominated bill.

## What Chompyy's detective takes

1. **Loops are rule #1**: error loops and re-fetch loops, using headroom's signature normalization and ≥ 3-in-a-session threshold, waste measured from output sizes. Fix = a CLAUDE.md line naming the command and the up-front way ("read the whole file", "use `--reporter=dot`").
2. **Environment facts**: commands that fail then succeed with a variant (`python3` → `uv run python`, wrong test command, wrong path) repeated across 2+ sessions → a CLAUDE.md fact.
3. **Verbosity from behaviour**, not from asking: interrupt + fast-skip pressure decides whether terse-output advice (caveman) is worth suggesting at all, and at which level.
4. **Don't sell re-read dedup**: measured 0.1 %. Flag re-reads only when they are stale-free *and* large, or when write-readback is common.
5. **Cache-death windows**: count idle gaps > 5 min per session; that's the cost of pausing (feeds the keep-warm advice from caveman).
6. **Dynamic content in CLAUDE.md / always-loaded files** (dates, "last updated", generated stats, `!`-command output) → advise moving it out of the always-loaded prefix.
7. **Safety for Chompyy itself**: run every headless call with `--strict-mcp-config` and hooks disabled, so other plugins' SessionStart/Stop hooks can't inflate or hijack Chompyy's runs.
8. **Write rules inside a marked block**, keep prior rules as the baseline, drop only on contradiction; cap the block so learned rules don't become their own startup tax.
