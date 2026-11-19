# The detective's rulebook

What Chompyy's detective knows: how to spot each flaw in your Claude Code setup and habits from **your own local files**, what to say, how to fix it, what the fix is honestly worth, and when not to suggest it.

Distilled from reading the code (not the READMEs) of six tools, 2026-11-17. Per-tool notes, with file and line references: [rtk](rtk.md) · [headroom](headroom.md) · [ponytail](ponytail.md) · [caveman](caveman.md) · [token-optimizer](token-optimizer.md) · [codeburn](codeburn.md). Research background: [landscape](../landscape-2026-11.md), [convergence](../feature-convergence.md), [evidence cards](../atomic-knowledge.md).

## 0. How the detective thinks and talks

These are the detective's personality. Every rule below obeys them.

1. **Evidence first, from your files.** Every finding names what was counted and where: "`npm test` output averaged 8.1k tokens in 31 sessions", not "your tests are noisy". No finding without a count.
2. **Say what it doesn't prove.** "Not seeing a skill used in 40 sessions doesn't prove you never need it." "A count of subagents doesn't prove any one was unnecessary." (caveman's wording rules)
3. **Measured vs estimated, always labelled.** A saving computed from your token counts is *measured*; one from a per-unit model (e.g. "≈100 tokens per skill description") is *estimated*. (codeburn `FINDING_BASIS`)
4. **No dollars on a subscription.** Your plan has no marginal cost. Savings are shown as **% of your 5-hour window and weekly limit**, and as "tokens a day". (caveman, token-optimizer)
5. **Independent numbers over vendor numbers.** When a fix comes from a tool, quote the independent test first and the tool's own claim second, both labelled. rtk claims 70–99 % per command; JetBrains measured **+7.6 % cost** at low effort. Stacked rtk + headroom + caveman saved **3.7 %** of a real bill.
6. **Cache-aware pricing.** A token is not a token. Weights (Anthropic): input 1, output 5, cache write 1.25 (5-min) or 2 (1-hour), cache read 0.1. A token removed early in a long session saves a write plus a read on every later turn; one removed after the last turn saves almost nothing. (rtk `cc_economics.rs` prices at the input rate only and misses this; headroom, caveman get it right)
7. **Pre-registered checks.** Each fix states, before it's applied, what will be measured afterwards and what counts as "worked". (token-optimizer `file_refetch.py`)
8. **Smallest fix first.** A flag on a command beats a CLAUDE.md line, which beats a new tool, which beats a proxy. Installing another optimizer is never the first suggestion.
9. **Never invent a per-repo saving for "write less".** The unbuilt version never existed, so there's no baseline; quote the benchmark and measure output tokens afterwards. (ponytail `ponytail-gain` honesty boundary)
10. **Count each thing once.** Group by `tool_call_id` (resumed sessions replay earlier turns), skip subagent re-reads of what the parent read, and charge a project's CLAUDE.md only to sessions that ran under it. (headroom `loops.py`, codeburn, caveman `configTurnsPerDay`)

### Fix lanes

| Lane | What happens after you approve | Examples |
|---|---|---|
| **Settings** | Chompyy applies the exact diff you saw, backs up the file, records a hash for drift-checked undo, and never while a Claude Code session is open | archive a skill, remove an MCP server, set `autoCompactWindow`, add a `permissions.deny` |
| **Work** | A sandboxed agent card on its own branch; you keep or undo | trim CLAUDE.md, write a repo-facts section, add a test-reporter flag to a script |
| **Habit** | Advice only; nothing to apply. Measured afterwards like any other | compact at phase boundaries, start fresh past half the window |
| **Terms** | Warning only; Chompyy never sets it up | a local proxy in front of the API, automated keep-warm pings |

### Data the rules read (all local)

- Transcripts: `~/.claude/projects/*/*.jsonl` (main + subagent files; `isSidechain`).
- Per assistant turn, `message.usage`: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, and `cache_creation.{ephemeral_5m,ephemeral_1h}_input_tokens` (the cache lifetime actually written).
- `message.diagnostics.cache_miss_reason.type`: Claude Code's own reason for a cache miss (`previous_message_not_found`, `tools_changed`, `messages_changed`) and `cache_missed_input_tokens`. On this machine: 129 × `previous_message_not_found`, 2 × `tools_changed` (61k and 166k tokens missed), 2 × `messages_changed`.
- `tool_use` / `tool_result` pairs (name, input, output size, `is_error`), `compact_boundary` entries with `preTokens`, `[Request interrupted by user` markers, timestamps.
- Config: `~/.claude/settings.json` and project `.claude/settings*.json` (hooks, permissions, env, statusLine), `~/.claude.json` and `.mcp.json` (MCP servers), `~/.claude/{skills,agents,commands,plugins}`, CLAUDE.md files (user, project, nested), auto-memory MEMORY.md.

Size from a tool result: characters ÷ 4 (every tool uses this; label it *estimated*). Size of a turn: the provider-counted `usage` (label it *measured*).

---

## 1. Startup tax: what loads before you type

Facts: plain Claude Code starts near **19.4k tokens**; ~800 tokens per tool description (our B2). On short tasks the startup cache write was **~80 %** of the cost (B3). On a subscription the main session writes a **1-hour** cache (checked on this machine), so the startup tax is paid once per session, again after every compaction, and once per subagent.

### S1 · Measured prefix vs what we can explain
- **Signal:** first turn of each session: `cache_creation + cache_read + input` (measured prefix). Static sum: CLAUDE.md files that load for that cwd + skill descriptions + agent descriptions + command menu + MCP tool definitions (deferred or not).
- **Fires when:** always reported (as the baseline); a finding when **unexplained = measured − static ≥ 3k tokens** in ≥ 3 sessions.
- **Say:** "Your sessions start at a median 24.1k tokens before your first word. CLAUDE.md, skills and MCP explain 15.3k; 8.8k comes from something else, most likely hooks that add context at session start (ponytail, caveman, token-optimizer…)."
- **Fix:** none on its own; it points to S6/K2. Lane: —.
- **Source:** caveman `learn.go` `config_tax:baseline` + `unexplained_prefix_tokens`; caveman `subagent-tax` method.

### S2 · CLAUDE.md too long
- **Signal:** each CLAUDE.md (user, project, nested) lines and tokens; charged only to turns of sessions whose cwd loads it.
- **Fires when:** > **200 lines** (Anthropic's documented guidance) or > **2,000 tokens**; high above 400 lines.
- **Say:** "Your project CLAUDE.md is 412 lines (~5.3k tokens) and loads in every session under this repo: 1,240 turns in 30 days."
- **Fix (work):** a card to tier it: keep identity, critical rules and key paths; move workflows into skills (load on demand) and long guides into files it reads when needed. Keep the agent's rules intact; never delete a rule without saying where it went.
- **Saving:** *measured* tokens removed × sessions that load it (first turn writes it at 2×, later turns read it at 0.1×).
- **Don't when:** the file is long because it holds facts that prevent loops (L1/L2 rules). Those earn their place; check the loop rate before cutting.
- **Check after:** deterministic re-count of the file (strongest rung, M2), plus measured prefix (S1) drops by roughly that amount.
- **Source:** codeburn `claude-md-too-long` (200/400), caveman `claude_md_weight` (150 lines/2k tokens), token-optimizer tiering.

### S3 · Unused skills, agents and commands
- **Signal:** installed skills/agents/commands vs invocations in the scan window (Skill tool calls, `/name` prompts, Task `subagent_type`).
- **Fires when:** ≥ 5 skills unused (≥ 10 high), ≥ 2 agents unused, ≥ 10 commands unused, in ≥ 20 sessions over ≥ 14 days. Skip anything installed in the last 24 h.
- **Say:** "9 skills had no use in 46 sessions over 30 days; their descriptions add ~1.1k tokens to every session start. Not seeing a skill used doesn't prove you never need it."
- **Fix (settings):** archive **outside** `~/.claude/skills/` (a `_archived/` folder inside still loads). Never archive Chompyy's own or a measurement tool's skills.
- **Saving:** *estimated* (description tokens × sessions).
- **Source:** codeburn `unused-skills/agents/commands`, caveman `dead_load:skills`, token-optimizer archive rule.

### S4 · MCP servers: unused, low coverage, wrong scope
- **Signal:** configured servers (user + project), their tool counts, calls per server, projects where they're called, whether Tool Search deferral is active.
- **Fires when:** a server has **0 calls** in ≥ 2 sessions after a 24 h grace; or ≥ 10 tools with < 20 % ever used; or ≥ 80 % of its calls come from one or two projects (→ project scope); or `alwaysLoad` servers used < 0.2 times per session.
- **Say:** "`figma` (34 tools) was loaded in 51 sessions and called in 2, both in `branchwork`. Move it to that project's `.mcp.json`."
- **Fix (settings):** project-scope or remove, with backup.
- **Don't when:** deferral is on and the measured prefix (S1) shows the server costs little. Tool Search defers definitions by default now, so older "MCP costs thousands per turn" numbers are often wrong. Measure before advising (token-optimizer anti-pattern).
- **Check:** a mid-session server change shows as `cache_miss_reason: tools_changed` (C2); a reconnecting or flapping server costs a full cache rebuild each time.
- **Source:** codeburn `unused-mcp`, `mcp-low-coverage`, `mcp-project-scope`, `mcp-alwaysload-hygiene`, `mcp-deferral-off`; caveman `mcp_tax`.

### S5 · MEMORY.md truncated or duplicated
- **Signal:** auto-memory MEMORY.md lines/bytes; overlap with CLAUDE.md (lines of ≥ 6 words appearing in both); `@import` targets that don't exist.
- **Fires when:** past **200 lines or 25 KB** (Claude Code stops loading the rest at session start); duplicated rules; broken imports.
- **Say:** "MEMORY.md is 241 lines; Claude Code loads only the first 200, so the last 41 never reach the agent."
- **Fix (work):** compress the index, one line per memory; remove duplicates from one side.
- **Source:** caveman `detect_memory_health.go` (citing code.claude.com/docs/en/memory), token-optimizer.

### S6 · Hooks that inject context, and plugins that inject into every subagent
- **Signal:** hooks on `SessionStart`, `UserPromptSubmit`, `SubagentStart` in settings and plugins; their output size where transcripts show it (`hook_additional_context`, system reminders); S1's unexplained gap.
- **Fires when:** injected context ≥ 1k tokens per session start, or any `UserPromptSubmit` hook adding text to **every prompt**, or a `SubagentStart` injector (cost × subagents spawned).
- **Say:** "ponytail adds ~900 tokens of rules plus a ~500-token codebase map at every session start, resume, clear and compact, and the same rules again in each of your 6.2 subagents per session."
- **Fix:** keep it if you want its behaviour (see W2), but scope it: ponytail's `PONYTAIL_SUBAGENT_MATCHER`, or turning off the parts you don't use (lane: settings).
- **Source:** ponytail `hooks/claude-codex-hooks.json`, `ponytail-subagent.js`; caveman `config_surface` (hooks + plugins ≥ 10).

---

## 2. Cache: the biggest line on the bill

Facts: in a 500-session bill, **42 % was cache writes** (B1). Writes cost 1.25× (5-min) or 2× (1-hour) input; reads cost 0.1×. Most "savings" levers fight the cache (H3). On a subscription the main conversation's cache lives **1 hour**, subagents' **5 minutes** (token-optimizer; the 1-hour part is confirmed on this machine).

### C1 · Cold resumes: you came back after the cache died
- **Signal:** a turn with `cache_miss_reason: previous_message_not_found` (or cache_creation > 10k and > ¼ of context with near-zero read) after a gap longer than the lifetime that turn's predecessor wrote (`ephemeral_1h` → 60 min, `ephemeral_5m` → 5 min).
- **Fires when:** ≥ 3 cold resumes in 14 days, or cold-resume rewrites ≥ 5 % of all cache writes.
- **Say:** "12 times this fortnight you came back to a session after more than an hour; each return rewrote the whole context (median 84k tokens). That was 9 % of your cache writes."
- **Fix (habit):** before a long break, finish the thought and start fresh on return from a short note (C5 evidence: externalise state to files, then a fresh session replaces a long one). Or `/compact` before leaving so the rewrite is small.
- **Don't:** suggest automated keep-warm pings. Measured to pay off on the API (caveman: net $1,897 for $385 of warms on held-out data) but on a plan it sends requests on your behalf: see T2.
- **Source:** caveman `detect_cache_hygiene.go` (classification), `cache_warm.go` (TTL rule `min(0.9×TTL, TTL−10s)`), headroom `audit/reads.py` cache-death windows, token-optimizer TTL by plan.

### C2 · Mid-session cache invalidation
- **Signal:** `cache_miss_reason: tools_changed` or `messages_changed`, with `cache_missed_input_tokens`; or ≥ 3 spikes (cache_creation > 10k and > ¼ of context) in a session with no long gap.
- **Fires when:** ≥ 2 sessions with an invalidation, or any single invalidation ≥ 50k tokens.
- **Say:** "Twice the tool list changed mid-session (an MCP server reconnected or was toggled) and 61k and 166k tokens had to be re-cached."
- **Likely causes to check, in order:** MCP server connect/disconnect or `/mcp` toggles; a plugin or proxy rewriting earlier messages (K3); model switch mid-session; settings change mid-session.
- **Fix:** depends on cause: pin flaky MCP servers off for that project (settings), remove the rewriting proxy (K3).
- **Source:** caveman `cacheChurnSink` (thresholds 10k, 3 spikes, 2 sessions); headroom `prefix_tracker.py` (never modify cached messages).

### C3 · Changing text in always-loaded files
- **Signal:** CLAUDE.md / rules / memory files containing dates, times, "last updated", version stamps, counts or generated stats; files rewritten by a tool between sessions (hash changes on many days).
- **Fires when:** an always-loaded file changes in ≥ 3 of the last 14 days without you editing it (mtime vs git log), or contains timestamp/UUID-like strings.
- **Say:** "`CLAUDE.md` has a `Last updated:` line that a script rewrites daily; every rewrite invalidates the cached prefix for all your sessions in that repo."
- **Fix (work):** move dynamic content out of always-loaded files, or to their end.
- **Source:** headroom `dynamic_detector.py` (dates, times, UUIDs, request/session ids, versions, high-entropy strings).

### C4 · Low cache hit rate without a known cause
- **Signal:** session cache_read ÷ (cache_read + cache_creation + input) < **80 %** with ≥ 5 calls, after excluding C1/C2 turns.
- **Say:** "4 sessions read under 80 % of their input from cache, for no reason Claude Code recorded."
- **Fix:** investigation card only (lane: work, read-only): which turn's prefix differed.
- **Source:** codeburn `low-cache-hit-sessions` (estimated basis).

---

## 3. Shell and tool output: what comes back

Facts: compress output **before** it enters history, never after (C2 in our cards: deleting history broke the cache in all 42 tested configs on cache-aware pricing). Compression tools save much less than they claim on a whole bill.

### O1 · Noisy command families
- **Signal:** for each Bash command family (rtk's rule table: `git log/diff/show/status`, `gh pr/issue/run`, test runners `jest/vitest/pytest/go test/cargo test`, builds `tsc/next/mvn/gradle`, `docker/kubectl logs`, `ls -R/find/tree`, package managers), runs and median/total output tokens (chars ÷ 4), weighted by turns remaining in the session (cache reads that output will incur).
- **Fires when:** a family has ≥ 3 runs in ≥ 3 sessions, median ≥ **2k tokens**, and ≥ **5 %** of all tool output (caveman tool portfolio: ≥ 20k tokens, ≥ 3 calls, ≥ 5 % share).
- **Say:** "`npm test` ran 64 times in 31 sessions; median output 8.1k tokens, mostly passing tests. It's 18 % of everything your tools returned."
- **Fix, smallest first:** (1) **work:** a quieter invocation the agent can use (`--reporter=dot`, `-q`, `--silent`, `git log --oneline -n 20`, `--json` only when parsed), written once into CLAUDE.md as a command fact; (2) **settings:** rtk *for that family only* (its `hooks.exclude_commands` for the rest), with recovery enabled.
- **Saving:** *estimated*: removed tokens × (cache write weight + 0.1 × median turns remaining). Show the independent number next to rtk's claim.
- **Don't when:** the agent re-runs that family right after with more output (O2/L2): the output is being used.
- **Check after:** that family's median output, and re-fetch rate (O2) stays < 10 %.
- **Source:** rtk `src/discover/` (family classification, history scan), `rules.rs` (families only, not its % claims); caveman `detect_tool_portfolio.go`; codeburn `bash-output-cap` (the global cap; Chompyy prefers per-family).

### O2 · The agent fights the filter
- **Signal:** with a compressor installed: `rtk recall`/`rtk bypass`/`RTK_DISABLED=1`, retrieval of a compressed original (`ccr://`, `headroom_retrieve`, caveman recovery), or the same command re-run within 3 tool calls with fewer filters.
- **Fires when:** recalls ÷ compressions ≥ **10 %** (watch) or ≥ **30 %** (too aggressive), with ≥ 5 compressions; or ≥ 200 events and re-fetch > **15 %** for a family.
- **Say:** "After rtk shortened `pytest` output, the agent fetched the full output again 9 times out of 26 (35 %). For pytest, the filter costs more than it saves."
- **Fix (settings):** exclude that family from the compressor.
- **Source:** rtk `analytics/gain.rs` (`recall_verdict` 10/30 %, min 5); token-optimizer `file_refetch.py` (200 events; > 15 % lossless; < 5 % may widen); caveman `proxy/CLAUDE.md` (masking JSON/log output → 27–97 recovery calls, 0/6 on two tasks).

### O3 · Big structured output masked instead of summarised
- **Signal:** JSON / table / log tool results replaced by a pointer stub (`ccr://`, "[N lines omitted]") followed by retrievals.
- **Fix (settings):** for those classes, compress in place (rows + invariants) or not at all.
- **Source:** caveman "mask what cannot be summarized in place; elide what can".

### O4 · Repeated pasted block
- **Signal:** a user message opening with the same ≥ 1 KB block (hash of normalized text) in ≥ 3 sessions.
- **Say:** "You pasted the same 3.4 KB API spec at the start of 7 sessions."
- **Fix (work):** standing rules into CLAUDE.md; reference material into a file the agent reads when needed.
- **Source:** codeburn `recurring-context`, caveman `cross_provider:repaste`.

---

## 4. Reading files

### R1 · Re-reads that were really needed vs not
- **Signal:** Read calls per path per session with output size; edits to that path between reads; partial reads contained in an earlier full read; reads that echo a prior Write.
- **Fires when:** **unneeded** re-reads (no edit in between, not a subset after a compaction) ≥ 3 per path and ≥ 5k tokens in a session, in ≥ 3 sessions.
- **Say:** "`board.ts` (6.2k tokens) was read whole 5 times in one session without being changed in between."
- **Fix (work):** a codebase map or file facts in CLAUDE.md ("`board.ts`: card types at top; transitions in `move()`"), or ask for ranges.
- **Saving:** *measured* from real sizes, not a flat 600 tokens per read.
- **Honest scale:** headroom built dedup of byte-identical re-reads and **removed it: 0.1 % of Read bytes** on real traffic. Most re-reads follow an edit. Report this rule only when it clears the threshold, and never as a big win.
- **Source:** headroom `audit/reads.py`; caveman `detect_reread.go` (≥ 3 calls, ≥ 5k); codeburn `redundant-rereads` (counted by path, flat 600: overstates).

### R2 · Reading build output, dependencies, lockfiles
- **Signal:** Read/Grep/Glob results under `node_modules`, `dist`, `build`, `target`, `.next`, `vendor` (only with a sibling manifest proving it's generated), `*.lock`, `package-lock.json`, `go.sum`, minified files.
- **Fires when:** ≥ 3 such reads (≥ 5 medium, ≥ 20 high).
- **Fix (settings):** a **project-level** `permissions.deny` for exactly those paths (zero tokens per turn).
- **Don't when:** the agent needed them (it read them, then used them in an edit or answer). A deny on a path the agent wants returns an error every time, and those errors stay in history and cost tokens.
- **Check after:** "permission denied" repeats on the denied paths (should be ~0).
- **Source:** codeburn `build-folder-reads`, token-optimizer deny caveat, caveman vendored-dir rules (`build`/`dist`/`vendor` are ambiguous without a manifest).

### R3 · Compaction re-reads
- **Signal:** `compact_boundary` events; files read before compaction and read again after.
- **Fires when:** ≥ 2k tokens re-read after compactions in ≥ 2 sessions.
- **Fix (habit):** compact at phase boundaries (after research, after debugging, after a milestone), save progress notes before compacting, or start fresh. (settings) `autoCompactWindow` / `/autocompact <n>` if auto-compact fires mid-task.
- **Source:** caveman `detect_compaction.go`, token-optimizer compaction timing, `compaction_survival.py`.

---

## 5. Loops and environment facts

Loops rank first: their waste grows with every repetition (headroom). Fixing them is almost always a one-line CLAUDE.md fact.

### L1 · Error loops
- **Signal:** within one session, the same call signature fails ≥ 3 times. Signature: Bash `command`, Read `file_path`, Grep/Glob `pattern`+`path`; lower-cased, whitespace collapsed; de-duplicated by `tool_call_id`.
- **Say:** "`python3 -m pytest` failed with ModuleNotFoundError 4 times in 3 sessions; `uv run pytest` worked each time."
- **Fix (work, tiny):** one CLAUDE.md line under "Environment": "Run tests with `uv run pytest`, not `python3 -m pytest`."
- **Saving:** *measured*: output tokens of the N−1 failing repeats, per session it recurs in.
- **Source:** headroom `learn/loops.py` (≥ 3, N−1 counted), `ErrorCategory` (file not found, module not found, command not found, permission denied, file too large…); caveman `learn_loops.go`.

### L2 · Re-fetch loops
- **Signal:** the same command with only pagination changed (`| head -n N`, `| tail -n N`, `-n N`, `--max-count`, `LIMIT/OFFSET`, bare numbers → `N`) ≥ 3 times in a session; each call succeeds.
- **Say:** "`grep -rn TODO src | head -50` was re-run 4 times with bigger limits in one session."
- **Fix (work):** a CLAUDE.md line naming the up-front way ("read the whole file", "use `rg -c` first").
- **Don't:** add an output cap anywhere when this rule is firing (caps cause it).
- **Source:** headroom `loops.py` `_PAGINATION_PATTERNS`.

### L3 · Environment facts rediscovered
- **Signal:** across ≥ 2 sessions in a repo, the same discovery sequence: a wrong path/command → a working one; the same Glob/Grep to find the same file before working on it.
- **Fix (work):** a repo-facts section (marked block, capped size) in CLAUDE.md. An AGENTS.md cut runtime 28.6 % and output 16.6 % (E3, 2601.20404).
- **Governance:** keep prior facts as the baseline; drop one only when contradicted; a fact needs 2+ occurrences or your explicit instruction; cap the block so it doesn't become S2.
- **Source:** headroom `learn` prompt priorities + prior-patterns rule; TokenEconomizer's 3-confirmation rule (G2).

### L4 · Repeated procedures
- **Signal:** the same 3–6-step tool sequence in ≥ 3 sessions costing ≥ 15k tokens each time.
- **Fix:** a *candidate* skill or script, labelled as a candidate. A skill loads every session and pays back only when its pattern recurs, so it goes through a holdout check (M4), never a promised saving.
- **Source:** caveman `detect_procedures.go`; G1/G5 (distil only from verified successes).

---

## 6. Context and sessions

### X1 · The dumbzone
- **Signal:** per turn, provider-counted context ÷ model window.
- **Fires when:** ≥ **10 %** of turns past **50 %** of the window.
- **Say:** "18 % of your turns ran with the context more than half full. Answers get worse well before the window is full."
- **Fix (habit):** start a fresh session (from a short note) or compact before half the window.
- **Source:** caveman `context_dumbzone`; D2 (effective context ≪ advertised).

### X2 · Long-context price line
- **Signal:** calls whose prompt crosses the model's long-context threshold.
- **Fix (habit):** same as X1; on a plan these calls draw the window down faster.
- **Source:** codeburn `long-context-premium`.

### X3 · Context-heavy sessions
- **Signal:** input ≥ 75k and input:output ≥ 25:1 (target 15:1).
- **Say as:** a review candidate, not proof ("this can come from stale carryover or inherently context-heavy work").
- **Source:** codeburn `context-heavy-sessions` (measured basis).

### X4 · Subagent spend (report, never judge)
- **Signal:** tokens in subagent transcripts by `subagent_type`; spawns per session.
- **Fires when:** ≥ 100k subagent tokens in ≥ 3 sessions.
- **Say:** the split and per-type medians only. Never "spawn fewer"; never say a spawn was unnecessary.
- **Note:** subagents get a 5-minute cache even on a subscription (`subagentPromptCacheTtl` changes it).
- **Source:** caveman `detect_subagent_spend.go` (the standing decree); codeburn `fast-mode-background` (fast mode in subagents nobody waits for).

---

## 7. Output: what the agent writes

### W1 · Verbosity from behaviour
- **Signal:** interrupts (`[Request interrupted by user`) and fast skips (your reply arrives in < 50 % of the time a 250-wpm reader needs, on answers ≥ 150 words), over ≥ 10 human turns.
- **Decide:** `pressure = interrupt rate + fast-skip rate`: < 0.10 → leave it; < 0.30 → drop ceremony and echo; < 0.55 → conclusions first; above → still cap there.
- **Fix:** a short taste line (Chompyy's taste.md) or a terse-output skill. Terse prose is safe for strong models on routine work; forced brevity hurt a weaker model on math by 27.7 % (E5).
- **Saving:** a shorter reply saves its output tokens **plus** a cache read on every later turn until compaction. Measure signed and net of a control (M3). Independent: caveman −8.5 % output tokens (JetBrains).
- **Source:** headroom `learn/verbosity.py`; token-optimizer `output_reread.py`.

### W2 · Writing more code than asked
- **Signal:** Write/Edit volume (added lines) vs request size; new dependencies added; new files for one-off helpers; low read:edit ratio (< 2 reads per edit with ≥ 10 edits).
- **Fix:** the ponytail ladder as a taste line (need it? → already in the codebase? → stdlib? → installed dep? → one line? → minimum), or ponytail itself.
- **Saving:** benchmark only: ponytail's own −26 % cost (Bash off, no CLAUDE.md, 39 tasks × 5 runs); JetBrains −10.3 % on an earlier version. Never a per-repo number (rule 9). Measure output tokens per session after.
- **Source:** ponytail `SKILL.md`, `benchmarks/results/2026-10-07-agentic.md`; codeburn `read-edit-ratio`.

---

## 8. Clashes: optimizers fighting each other

Nobody else checks this. Detection is by what's installed (hooks, plugins, env, CLAUDE.md markers) plus what transcripts show.

How to recognise each tool:
- **rtk:** a `PreToolUse` Bash hook running `rtk`; `rtk ` commands in transcripts; `~/.config/rtk/`.
- **headroom:** `ANTHROPIC_BASE_URL` pointing at a local port, `headroom wrap`, its MCP server, `<!-- headroom:learn:start -->` in CLAUDE.md.
- **ponytail:** plugin with `SessionStart` + `SubagentStart` + `UserPromptSubmit` hooks, `~/.claude/.ponytail-active`.
- **caveman:** skill/plugin, `$CAVEMAN_HOME`, a local proxy base URL.
- **token-optimizer:** plugin hooks, its skills (`token-optimizer`, `token-coach`…).
- **codeburn guard:** `PreToolUse`/`PostToolUse` hooks from `codeburn guard install`.
- Drop-in CLAUDE.md "be terse" blocks (claude-token-efficient and similar).

### K1 · Two compressors on the same output
- **Fires when:** ≥ 2 of {rtk hook, headroom proxy/wrap compression, caveman proxy/read-less, context-mode} are active for Bash output.
- **Say:** "rtk and headroom both shrink your shell output. The second pass saves little and can drop what the first kept."
- **Fix (settings):** keep the one with the lower recall rate (O2) on your sessions; turn the other off for Bash.

### K2 · Prompt pile-up
- **Fires when:** ≥ 2 always-on "be lean" instruction sets (ponytail, caveman skill, terse CLAUDE.md block, Chisle…), or their combined injection ≥ 2k tokens per session start.
- **Say:** "Three 'be brief' rule sets load at every session start (~2.6k tokens) and say overlapping things."
- **Fix (settings):** keep one; measure W1/W2 after.

### K3 · A proxy rewriting what was already cached
- **Fires when:** API traffic goes through a local proxy that compresses or edits messages, **and** C2 invalidations or ≥ 3 cache spikes per session appear after it was installed.
- **Say:** "Since the proxy was set up, 6 sessions re-cached 50k+ tokens mid-session; editing earlier messages turns a 90 % read discount into a 25 % write surcharge."
- **Fix:** turn off its history compression, or remove it. (Also T1.)
- **Source:** headroom `prefix_tracker.py`; caveman harm tripwire (strike when cache_creation > 50k and > 3× baseline; 3 strikes freeze).

### K4 · Two learners writing the same files
- **Fires when:** ≥ 2 tools write managed blocks into CLAUDE.md/MEMORY.md (headroom learn, caveman learn, token-optimizer, Chompyy's own taste).
- **Say:** "headroom and caveman both add rules to CLAUDE.md; it grew 140 lines in 3 weeks and two rules contradict."
- **Fix (work):** one owner per file; merge and dedupe.

### K5 · Two keep-warm or two status lines
- **Fires when:** two tools ping to keep the cache warm, or two tools fight over `statusLine` (ponytail rewrites its statusline copy every session).
- **Fix (settings):** one owner (Chompyy's status line wraps others rather than replacing them).

### K6 · Router vs. verifier
- **Fires when:** a model router picks a cheap model while a skill pushes extra verification steps.
- **Say as:** a question, not a finding (untested in the research).

---

## 9. Terms and safety

### T1 · Local proxy in front of the API
- **Signal:** `ANTHROPIC_BASE_URL` (settings env or shell) pointing at `localhost`/`127.0.0.1` or a non-Anthropic host.
- **Say:** "Your Claude Code traffic goes through a local proxy (rtk-proxy / headroom / caveman). Some of these relay or route subscription traffic; check your provider's terms." Never recommend setting one up. (Chompyy's rule: no relays, no getting around plan limits.)
- **Note:** rtk-proxy is BUSL-1.1 and "relays routed work to cheaper models".

### T2 · Automated keep-warm pings
- Measured to save on the API (caveman), but on a plan "a ping uses plan limits" and is automated use; token-optimizer paused theirs for that reason. Chompyy reports cold resumes (C1) and suggests habits; it never pings.

### T3 · Chompyy's own headless calls
- Every `claude -p` Chompyy runs must not pick up other plugins' hooks or MCP servers: add `--strict-mcp-config` and `--settings '{"disableAllHooks":true}'` (alongside `--tools ""` where no tools are needed). Otherwise a SessionStart hook inflates every Chompyy call and a blocking Stop hook can replace the answer. (headroom `learn/analyzer.py` `_CLI_BACKENDS`.) **Status: done** (`cli/src/runner.ts` `ISOLATION_ARGS`; measured: agent runs start 2,224 tokens smaller on this machine).

### T4 · Safe reads of repos
- Running `git` in a repo Chompyy didn't create: pass `-c core.fsmonitor= -c core.hooksPath=/dev/null` and friends, and strip inherited `GIT_*`; a hostile `.git/config` can run code on `git status`. (caveman `gitsafe`)

---

## 10. Did it work? (measuring each fix)

### M1 · Provenance
At apply time, hash the file the fix changed. Later: `intact` / `changed since` / `missing`. If you edited past it, the result is downgraded, not kept. (caveman `learn_attribution.go`; codeburn `afterHash`)

### M2 · Method rungs, strongest first; never summed across rungs
1. **Re-count** the artifact (bytes on disk): S2, S3, S5, S6 trims.
2. **Holdout:** sessions with the change on vs off on this machine (only rung that controls for you): skills, verbosity, compressors.
3. **Replay:** recompute scanned history as if the change were in place: deny rules, MCP scope.
4. **Before/after:** sessions before vs after; can't separate the fix from anything else that week; labelled so.

### M3 · Rules for the numbers
- Wait **≥ 3 days** of sessions; "worked" at **≥ 70 %** of the promised saving; round realized savings down. (codeburn `act`)
- Credits are **signed**: a regression is shown as a regression, never clamped to zero, never priced as a saving. (token-optimizer, caveman)
- Net of a **control** where one exists. (token-optimizer `output_reread.py`)
- Each fix's check and threshold are written on its card **before** it's applied (rule 7).

### M4 · Candidates
Anything that adds context to every session (a new skill, a repo-facts block, a terse-output rule) is a **candidate** until a holdout shows it pays back. (caveman procedures)

---

## Sources and licences

| Tool | Commit read | Licence | What we may reuse |
|---|---|---|---|
| rtk | `6c94fc5` (2026-11-17) | Apache-2.0 (CLI); **BUSL-1.1** (`proxy/`) | ideas; CLI code with notice; nothing from `proxy/` |
| headroom | `18067b1` (2026-11-16) | Apache-2.0 | ideas and code with notice |
| ponytail | `96608e0` (2026-10-29) | MIT | ideas and code with credit |
| caveman | `9b24366` (2026-11-16) | Apache-2.0 | ideas and code with notice |
| token-optimizer | `bbf3b8c` (2026-11-16) | **PolyForm Noncommercial** | **ideas only**, our own words; no code or text |
| codeburn | `40d5880` | MIT | ideas and code with credit (already vendored: quota reader) |

Re-read monthly, like the vendored code: thresholds above should be re-checked against each tool's latest commit.
