# Token saving for coding agents: the landscape (2026-11)

Issue [#1](https://github.com/BranchWork-HQ/token-saving-research/issues/1). Stats measured 2026-11-08 with [`tools/repo_stats.py`](../tools/repo_stats.py) ([snapshot](../data/snapshots/2026-11-08.jsonl)); 71 projects from ~800 search hits, screened by hand.

## Answer first

1. **The popular tools save little of the bill.** The advertised 60–95 % numbers divide by one payload (one shell command, one reply), not by the bill. Independent tests: caveman −8.5 % output tokens, rtk **+7.6 %** cost at low effort, ponytail −10 % cost (JetBrains, paired A/B); rtk + headroom + caveman stacked = **3.7 %** of a 500-session, $926 bill [E1–E4].
2. **The bill sits where they don't reach.** In that replay, **42 % was cache writes** and **29 % output**; compressors only touch the other 29 % [E4]. BranchWork's own PR #107 agrees: ~80 % of plain Claude Code's cost was the startup cache write, and a lean harness on a cheap model passed the same 34/34 at 1/39 the cost.
3. **What does work, with evidence: choosing less** — a cheaper model (PR #107: 39×), fewer tools loaded, and not rediscovering the same repo facts. TokenEconomizer (Microsoft Research + Berkeley, Oct 2026) measured **−18–31 % cost with Pass@1 up** on 277 SWE-bench tasks by learning across sessions [E5].
4. **The #117 "waste autopsy" niche is taken.** codeburn `optimize` (11.7k ⭐) finds waste, applies fixes with undo and checks each fix's promise later; token-optimizer (2.9k) audits "ghost tokens"; agentacct issues work receipts. A new autopsy would need a different reason to exist.
5. **The money is moving to routing.** Compressors are cooling (0.3× their average pace); gateways that put any model in any agent are the fastest risers (magpie: 2 months old, 32k ⭐, still 620/day).

## Where the tokens go, and who works on each part

```
 a coding-agent bill (500-session replay [E4])
 ┌──────────────────────────┬──────────────────┬──────────────────┐
 │ cache writes 42 %        │ output 29 %      │ reads+fresh 29 % │
 │ startup prefix, new      │ prose, code,     │ history re-read, │
 │ sessions, cache misses   │ thinking         │ tool output      │
 └────────────┬─────────────┴────────┬─────────┴────────┬─────────┘
   startup-tax · cache · lean-harness  say-less          compress-input · retrieve-less
                    route (cheaper price on all three) · learn (fewer turns on all three)
                    see (measures all three, changes none)
```

| Angle | Lever | Crowd | Best evidence | Verdict |
|---|---|---|---|---|
| **say-less** | shorter replies, less code | 7, two of the largest repos | −8.5 % output, −10 % cost (independent) | real but small; cheap to copy |
| **compress-input** | shrink tool output before it lands | 15, crowded | 3.7 % of a bill stacked; rtk +7.6 % cost | oversold; cache-breaking can cost more |
| **retrieve-less** | read the symbol, not the file | 6 | none independent | plausible; serena is the steady one |
| **startup-tax** | load fewer tools and instructions | 5, small | BranchWork #116: 19.4k → 3.8k startup tokens | **under-served**, hits the 42 % |
| **cache** | keep the prefix stable, rotate bloated sessions | 2, tiny | cache-fix: up to 20× on resume bugs | **under-served**, hits the 42 % |
| **route** | cheaper model / effort per task | 11, hot | PR #107: same pass at 1/39 the cost | biggest lever; gateways crowded, *quality-checked* routing isn't |
| **learn** | don't rediscover; prune what goes unused | 5 | TokenEconomizer −18–31 % (paper) | strongest evidence; one serious player, 1 month old |
| **see** | show the spend and the waste | 9, crowded | – (measures, doesn't save) | taken: codeburn closed the fix loop |
| **lean-harness** | an agent built small | 5 + Pi | caveman-code 1.93× vs Codex | Pi (120k ⭐) is the base others plug into |
| **schedule** | spend the plan window when you are away; start it when you need it | 5, all tiny (≤ 182 ⭐) + Claude Code Routines (first-party) | none measured | **empty and unjoined**: warm-up, queue and quota readers exist separately |

## Projects by angle

"⭐/day now" comes from the events feed: hours for a hot repo, up to 90 days for a quiet one (see the tool's header). Momentum = now ÷ lifetime: above 1 is accelerating, below ~0.3 is cooling. Launch spikes make most repos look like they're cooling; compare within a row's peers.

#### say-less

| Repo | ⭐ | Started | ⭐/day now ÷ lifetime | Hooks in | What it does |
|---|---|---|---|---|---|
| [ponytail](https://github.com/DietrichGebert/ponytail) | 186.6k | 2026-06 | 510.5 ÷ 1252.4 (0.41×) | skill/plugin | Laziest senior dev: YAGNI ladder so the agent writes less code. Claims −22 % tokens; JetBrains measured −10.3 % cost |
| [caveman](https://github.com/JuliusBrussee/caveman) | 118.2k | 2026-04 | 194.5 ÷ 542.4 (0.36×) | skill + proxy + CLI | Terse replies, now 6 "rocks" (read less, Auto routing, code-mode Blocks, cache warm, browse). Claims 65 %; JetBrains measured −8.5 % output tokens |
| [claude-token-efficient](https://github.com/drona23/claude-token-efficient) | 6.2k | 2026-03 | 1.3 ÷ 27.7 (0.05×) | CLAUDE.md | One drop-in CLAUDE.md for terse output |
| [caveman-compression](https://github.com/wilpel/caveman-compression) | 1.1k | 2025-11 | 0.2 ÷ 3.1 (0.06×) | library | Removes predictable grammar from context (input side) |
| [Chisle](https://github.com/JayPokale/Chisle) | 746 | 2026-06 | 1.3 ÷ 5.7 (0.23×) | skill + hooks | Terse prose, YAGNI-first code and tool-output compression in one |
| [honey-for-devs](https://github.com/Green-PT/honey-for-devs) | 350 | 2026-06 | 0.4 ÷ 2.5 (0.16×) | skill | Cross-tool "I shrunk the AI" skill |
| [caveman-micro](https://github.com/kuba-guzik/caveman-micro) | 182 | 2026-04 | 0.1 ÷ 0.9 (0.11×) | prompt | 85-token caveman prompt that beat the 552-token original on its own benchmark |

#### compress-input

| Repo | ⭐ | Started | ⭐/day now ÷ lifetime | Hooks in | What it does |
|---|---|---|---|---|---|
| [rtk](https://github.com/rtk-ai/rtk) | 85.9k | 2026-01 | 90.3 ÷ 297.1 (0.30×) | CLI proxy (Rust) | Rewrites 100+ shell commands' output. Counts chars÷4 of Bash only; JetBrains measured +7.6 % cost at low effort |
| [headroom](https://github.com/headroomlabs-ai/headroom) | 79.1k | 2026-01 | 82 ÷ 260.3 (0.32×) | library + proxy + wrap + MCP | Compresses tool output, logs, RAG, history; `headroom learn` writes fixes into CLAUDE.md. Replay: 2.8 % of a real bill |
| [context-mode](https://github.com/mksglu/context-mode) | 33.7k | 2026-02 | 36.5 ÷ 130.5 (0.28×) | plugin (10 agents) | Runs tools in a sandbox, indexes output in SQLite, returns only what the agent asks for; "think in code" |
| [pxpipe](https://github.com/teamchong/pxpipe) | 7.6k | 2026-05 | 3.8 ÷ 44.4 (0.09×) | proxy | Renders bulky context as PNGs (~3× chars per token). Works on Gemini 4 / Fable 5; later Claude models regressed at reading them |
| [LLMLingua](https://github.com/microsoft/LLMLingua) | 6.8k | 2023-07 | 1 ÷ 5.6 (0.18×) | library | The research baseline: small-model prompt compression, up to 20× |
| [opencode-dynamic-context-pruning](https://github.com/Tarquinen/opencode-dynamic-context-pruning) | 4.5k | 2025-11 | 2 ÷ 12.7 (0.16×) | plugin (OpenCode) | Prunes stale tool results from the conversation (AGPL) |
| [lean-ctx](https://github.com/yvgude/lean-ctx) | 3.9k | 2026-03 | 2.5 ÷ 17.2 (0.15×) | gateway | Selects task-relevant context, records what was delivered |
| [claw-compactor](https://github.com/open-compress/claw-compactor) | 2.0k | 2026-02 | 0.1 ÷ 7.4 (0.01×) | library | 14-stage compression pipeline, reversible, AST-aware |
| [paritok-4b-v1](https://github.com/Paritok-official/paritok-4b-v1) | 1.4k | 2026-07 | 0.2 ÷ 12.4 (0.02×) | gateway + 4B model | A distilled 4B compressor model plus an embedding tool filter (~29k → ~8k tokens per turn) |
| [sqz](https://github.com/ojuschugh1/sqz) | 675 | 2026-04 | 0.4 ÷ 3.2 (0.12×) | hooks | Compresses tool output before it enters context |
| [lowfat](https://github.com/zdk/lowfat) | 584 | 2026-04 | 0.1 ÷ 2.8 (0.04×) | CLI | Strips noise from command output |
| [boost](https://github.com/jfrog/boost) | 545 | 2026-03 | 0.2 ÷ 2.2 (0.09×) | CLI | Save tokens, maximize context, safely |
| [entroly](https://github.com/juyterman1000/entroly) | 483 | 2026-03 | 0.2 ÷ 2 (0.10×) | hooks + MCP + proxy | Budgeted context selection with reversible omissions and a receipt per decision |
| [snip](https://github.com/edouard-claude/snip) | 478 | 2026-02 | 0.2 ÷ 1.8 (0.11×) | CLI proxy | rtk-style output filters, declared in YAML |
| [llmtrim](https://github.com/fkiene/llmtrim) | 268 | 2026-06 | 0.3 ÷ 1.8 (0.17×) | proxy | Compresses API requests in flight |

#### retrieve-less

| Repo | ⭐ | Started | ⭐/day now ÷ lifetime | Hooks in | What it does |
|---|---|---|---|---|---|
| [serena](https://github.com/oraios/serena) | 31.2k | 2025-03 | 36 ÷ 52.5 (0.69×) | MCP | Symbol-level retrieval and edits through language servers, instead of whole-file reads |
| [cocoindex-code](https://github.com/cocoindex-io/cocoindex-code) | 3.0k | 2026-02 | 2 ÷ 10.6 (0.19×) | CLI | AST-based embedded code search |
| [jcodemunch-mcp](https://github.com/jgravelle/jcodemunch-mcp) | 2.8k | 2026-02 | 0.9 ÷ 10.4 (0.09×) | MCP | Fetch the function you need, not the file |
| [ripwire](https://github.com/redhat-et/ripwire) | 2.5k | 2026-07 | 0 ÷ 25 (0.00×) | CLI + MCP | The ripgrep of AI context, C++23 |
| [gortex](https://github.com/zzet/gortex) | 2.0k | 2026-04 | 11 ÷ 9.4 (1.17×) | engine | Code-intelligence graph for agents, 257 languages |
| [ai-codex](https://github.com/skibidiskib/ai-codex) | 393 | 2026-04 | 0 ÷ 1.8 (0.00×) | CLI | Generates a compact codebase index |

#### startup-tax

| Repo | ⭐ | Started | ⭐/day now ÷ lifetime | Hooks in | What it does |
|---|---|---|---|---|---|
| [claude-token-optimizer](https://github.com/nadimtuhin/claude-token-optimizer) | 645 | 2025-11 | 0.5 ÷ 1.8 (0.28×) | CLI | Trims what Claude Code loads at session start (small CLAUDE.md, docs on demand) |
| [ratel](https://github.com/ratel-ai/ratel) | 554 | 2025-11 | 1.2 ÷ 1.5 (0.80×) | MCP layer | Fixes tool overload; ~80 % fewer tokens claimed |
| [mcptoon](https://github.com/activeing123/mcptoon) | 424 | 2026-07 | 6.3 ÷ 4.1 (1.54×) | MCP gateway | One gateway for all servers and skills, token-optimised |
| [pctx](https://github.com/portofcontext/pctx) | 285 | 2025-11 | 0.1 ÷ 0.8 (0.12×) | runtime | Turns MCP tools into code the agent calls ("code mode"), so schemas aren't sent each turn |
| [lazy-mcp](https://github.com/voicetreelab/lazy-mcp) | 114 | 2025-10 | 0 ÷ 0.3 (0.00×) | MCP proxy | Loads tools on demand |

#### cache

| Repo | ⭐ | Started | ⭐/day now ÷ lifetime | Hooks in | What it does |
|---|---|---|---|---|---|
| [claude-code-cache-fix](https://github.com/cnighswonger/claude-code-cache-fix) | 450 | 2026-04 | 0.2 ÷ 2.1 (0.10×) | proxy | Repairs prompt-cache bugs that caused up to 20× cost on resume; stabilises the prefix, watches TTL downgrades |
| [clauditor](https://github.com/IyadhKhalfallah/clauditor) | 430 | 2026-04 | 0 ÷ 2 (0.00×) | hooks | Blocks bloated sessions and rotates them with a saved handover |

#### route

| Repo | ⭐ | Started | ⭐/day now ÷ lifetime | Hooks in | What it does |
|---|---|---|---|---|---|
| [OmniRoute](https://github.com/cheaper-inference/OmniRoute) | 85.6k | 2026-02 | 258 ÷ 320.5 (0.80×) | gateway | 375 providers, 150+ free; never stop coding |
| [claude-code-router](https://github.com/musistudio/claude-code-router) | 38.0k | 2025-02 | 18.5 ÷ 61.3 (0.30×) | gateway | Route Claude Code to any model per task type |
| [magpie](https://github.com/yetone/magpie) | 32.1k | 2026-09 | 620.4 ÷ 712.4 (0.87×) | menu-bar gateway | Any model in any agent; fails over when a quota runs out |
| [ClawRouter](https://github.com/BlockRunAI/ClawRouter) | 6.7k | 2026-02 | 2.3 ÷ 24 (0.10×) | router | Agent-native router with wallet billing |
| [RouteLLM](https://github.com/lm-sys/RouteLLM) | 5.7k | 2024-06 | 1.4 ÷ 6.4 (0.22×) | library | The research baseline for learned routers (2024, quiet) |
| [cascadeflow](https://github.com/lemony-ai/cascadeflow) | 3.9k | 2025-10 | 0.2 ÷ 10.3 (0.02×) | library | In-loop cascades: per-step model choice, budget gates, escalate |
| [Misceo](https://github.com/MaySudo/Misceo) | 849 | 2026-07 | 22.9 ÷ 7.6 (3.01×) | gateway | Cheap-first routing with quality gates |
| [UncommonRoute](https://github.com/CommonstackAI/UncommonRoute) | 703 | 2026-03 | 0 ÷ 2.9 (0.00×) | router | Learned router: 82 % cost saved at 79 % accuracy (own numbers) |
| [NadirClaw](https://github.com/NadirRouter/NadirClaw) | 662 | 2026-02 | 0.1 ÷ 2.5 (0.04×) | router | Simple prompts to cheap models (source-available) |
| [HiRoute](https://github.com/higress-group/HiRoute) | 422 | 2026-09 | 3.8 ÷ 7.4 (0.51×) | local router | Stretches Codex / Claude Code subscriptions |
| [cheap-ag](https://github.com/muaaz9329/cheap-ag) | 311 | 2026-10 | 25.2 ÷ 31.1 (0.81×) | harness | Expensive model plans, a cheap model writes every line |

#### learn

| Repo | ⭐ | Started | ⭐/day now ÷ lifetime | Hooks in | What it does |
|---|---|---|---|---|---|
| [cangjie-skill](https://github.com/kangarooking/cangjie-skill) | 12.3k | 2026-04 | 67.1 ÷ 59.9 (1.12×) | skill | Distils books and videos into skills (not token saving: the "distil to a skill" pattern) |
| [TokenEconomizer](https://github.com/microsoft/TokenEconomizer) | 5.0k | 2026-10 | 58.6 ÷ 191.3 (0.31×) | plugin (9 agents) | Learns repo facts across sessions, prunes unused tools, judge-checked loop guard. −18–31 % cost on 277 SWE-bench tasks, Pass@1 up |
| [pro-workflow](https://github.com/rohitg00/pro-workflow) | 2.9k | 2026-02 | 0.5 ÷ 10.6 (0.05×) | plugin | Learns from your corrections into memory |
| [agentic-context-engine](https://github.com/kayba-ai/agentic-context-engine) | 2.6k | 2025-10 | 0.3 ÷ 6.7 (0.04×) | library | Reflects on failures, keeps a playbook of strategies; −49 % tokens on browser tasks |
| [openwolf](https://github.com/cytostack/openwolf) | 2.4k | 2026-03 | 0.4 ÷ 10.1 (0.04×) | local folder | Project memory, known fixes and handovers across agents, plus token accounting |

#### see

| Repo | ⭐ | Started | ⭐/day now ÷ lifetime | Hooks in | What it does |
|---|---|---|---|---|---|
| [ccusage](https://github.com/ccusage/ccusage) | 19.4k | 2025-05 | 10 ÷ 36.7 (0.27×) | CLI | The default: `npx ccusage`, cost from local logs |
| [codeburn](https://github.com/getagentseal/codeburn) | 11.7k | 2026-04 | 12 ÷ 56.4 (0.21×) | CLI + app | Spend by project, branch, task and PR; `optimize` finds waste, applies fixes with undo, `act report` checks the promise |
| [Claude-Code-Usage-Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) | 8.8k | 2025-06 | 1 ÷ 17.3 (0.06×) | CLI | Live usage with burn-rate predictions |
| [tokscale](https://github.com/junhoyeo/tokscale) | 5.8k | 2025-12 | 5.3 ÷ 17 (0.31×) | CLI + web | Cross-agent usage with a global leaderboard (the shareable one) |
| [claude-devtools](https://github.com/matt1398/claude-devtools) | 4.0k | 2026-02 | 0.8 ÷ 14.7 (0.05×) | app | Inspect session logs: tool calls, context breakdown, subagents |
| [token-optimizer](https://github.com/alexgreensh/token-optimizer) | 2.9k | 2026-02 | 10.6 ÷ 11.5 (0.92×) | plugin (6 agents) | Find the ghost tokens: per-component audit, compaction checkpoints, quality grade, loop detection |
| [claude-usage](https://github.com/phuryn/claude-usage) | 2.3k | 2026-04 | 0.6 ÷ 10.7 (0.06×) | dashboard | Local Claude Code usage dashboard |
| [agentacct](https://github.com/mikehasa/agentacct) | 755 | 2026-07 | 0.1 ÷ 7.1 (0.01×) | CLI + app | Work receipts: what agents did vs what it cost, with confidence labels, Reported ≠ Verified |
| [token-optimizer-mcp](https://github.com/ooples/token-optimizer-mcp) | 576 | 2025-10 | 1.3 ÷ 1.5 (0.87×) | MCP | Measures savings per agent, shares a live dashboard |

#### lean-harness

| Repo | ⭐ | Started | ⭐/day now ÷ lifetime | Hooks in | What it does |
|---|---|---|---|---|---|
| [pi](https://github.com/earendil-works/pi) | 120.7k | 2025-08 | 167.6 ÷ 265.3 (0.63×) | agent | Pi: the minimal coding agent many plugins above target |
| [opensquilla](https://github.com/TokenRhythm/opensquilla) | 7.1k | 2026-05 | 2.5 ÷ 38.4 (0.07×) | agent | Microkernel agent with a harness-native learned router (tech report, data flywheel) |
| [openclacky](https://github.com/clacky-ai/openclacky) | 1.2k | 2025-12 | 0.5 ÷ 3.9 (0.13×) | agent | The most token-efficient lightweight agent |
| [caveman-code](https://github.com/JuliusBrussee/caveman-code) | 946 | 2026-04 | 0.1 ÷ 4.4 (0.02×) | agent | Frozen; measured 1.93× fewer tokens than Codex CLI |
| [tura](https://github.com/Tura-AI/tura) | 665 | 2026-07 | 0.2 ÷ 5.4 (0.04×) | agent | 80 % less tokens, better results (own claim) |

#### schedule

| Repo | ⭐ | Started | ⭐/day now ÷ lifetime | Hooks in | What it does |
|---|---|---|---|---|---|
| [claude-warmup](https://github.com/vdsmon/claude-warmup) | 182 | 2026-03 | 0.1 ÷ 0.8 (0.12×) | cron + claude -p | Sends a tiny scheduled message so the 5-hour window starts early and resets when you need it |
| [qlaude](https://github.com/starsh2001/qlaude) | 23 | 2026-02 | 0 ÷ 0.1 (0.00×) | CLI + Telegram | Queue tasks, walk away, get pinged when Claude Code needs you |
| [overnight](https://github.com/yail259/overnight) | 12 | 2026-01 | 0 ÷ 0 (0.00×) | CLI | Batch runner: queue tasks, run overnight, wake up to results |
| [claude-blitz](https://github.com/ADM-NKH/claude-blitz) | 6 | 2026-05 | 0 ÷ 0 (0.00×) | CLI | Pre-reset backlog runner: burns queued tasks in parallel before the quota resets |
| [warmup](https://github.com/mohit-kumawat/warmup) | 3 | 2026-03 | 0 ÷ 0 (0.00×) | scheduler | Same warm-start trick; claims up to 2× more usable time |

## How growth reads

| Signal | Repos | Reading |
|---|---|---|
| Still near launch pace (≥ 0.8×) | magpie, OmniRoute, cheap-ag, token-optimizer, ratel, serena (0.69) | multi-provider routing and subscription-stretching are where people are going now |
| Accelerating (> 1×) | Misceo 3.0×, mcptoon 1.5×, gortex 1.2×, cangjie-skill 1.1× | small, early; cheap-first routing with quality gates, tool gateways, code graphs |
| Big but cooled (≈ 0.3×) | ponytail, caveman, rtk, headroom, context-mode | the viral wave of Feb–Jun 2026 has peaked; independent tests landed in July |
| Faded (< 0.05×) | claude-token-efficient, claw-compactor, paritok, agentacct, cascadeflow | single-trick or late; pace fell to near zero |

## Where there's room (for BranchWork-HQ)

Ranked by evidence for the lever × how empty the space is. Each one is testable with the existing `engine/bench.ts` and Trials ledger.

| # | Possibility | Why it's open | Moat (your #117 question) |
|---|---|---|---|
| 1 | **The honest benchmark**: a public, rerunnable, paired leaderboard of token tools, as **% of the whole bill** and pass rate, on real Claude Code runs | Only JetBrains has done paired tests, one-off, in July. Every README divides by the payload. You already have the harness (PR #107) and the habit (ledger rows with measured numbers) | the dataset and the credibility; a benchmark people cite isn't copied by pasting a markdown file |
| 2 | **Cache-write cutter**: plan sessions so the prefix is written once — lean startup, stable tool set, warm reuse across subagents and Dams | 42 % of the bill, 2 tiny projects. PR #107 row 37 already shows it's 80 % of default Claude Code's cost | measured per-task-type startup profiles; weak alone, strong as part of #1 or #3 |
| 3 | **Personal router that knows when cheap is enough**: learn from your own ⭐ / pass history per task type which model and effort suffice | gateways (magpie, OmniRoute) switch models but don't judge quality; the Quote engine already routes and records results | **your data**: a router trained on one person's outcomes is the black box you described in #117 — it can't be copied without the history |
| 4 | **Window planner**: read the live quota, queue work tagged "away", run it while you're out so no window resets unused, start the next window when you'll need it | 5 tools of ≤ 182 ⭐, each doing one piece; nobody joins quota → queue → schedule → route | the join plus your own week's data (when you're away, what's safe to run unattended) |
| 5 | **Join TokenEconomizer, don't rebuild it**: it is #113 + #116 done with a paper behind it (MIT) | one month old, one serious player | none; use it as a part, not a product |
| 6 | ~~Waste autopsy card~~ | codeburn, token-optimizer, agentacct, caveman "waste fixes" | kill test answered without running it: novelty fails |

### The window planner, looked at closer

```
 quota reader ──▶ "62 % left, resets in 1 h 40, weekly cap 71 % used"
       │
 queue (tasks tagged: away-safe · needs me) ──▶ planner ──▶ run now / at reset / warm start at 07:00
       │                                          │
       └──────────── router (cheap first) ◀──────┘   ──▶ Postcard when you're back
```

1. **Check the premise first: is an unused window actually lost?** Only if the **weekly** cap isn't what limits you. If you hit the weekly cap anyway, a window that resets unused loses nothing; the week's total is the real budget. Measure it from your own logs before building: how many weeks hit the weekly cap, and how many 5-hour windows reset with quota left (`codeburn quota` reads both limits).
2. **The hard part is choosing what's safe to run without you**: work that can't need a decision (tests, refactors with a spec, research, review prep). That is where the Site visit / Quote idea earns its keep: a task approved before you leave has its questions answered.
3. **Competition is first-party**: Claude Code Routines (scheduled tasks, cloud or local) already run prompts on a cron. The planner's value is deciding *what* and *when* from the quota, not the cron itself.
4. **Terms**: BranchWork #111 already flagged checking the plan's terms on scheduled warm-start messages before shipping that part.

### Should it all be merged into one tool?

Not as a bundle of compressors. As a measured, per-workload policy, yes.

| Merge as… | Why / why not |
|---|---|
| All-in-one bundle (compress + say less + route…) | Already done three times: caveman (6 "rocks"), token-optimizer, headroom. Savings **don't add**: stacked, three tools gave 3.7 % [E4], and one alone can cost more [E2]. Rewriting content the agent already sent can invalidate the prompt cache, which is the biggest line on the bill |
| **Measured composition** | Run combinations against each other on the same tasks (paired), find which pairs help, which cancel, which hurt, per task type. The output is a policy ("for quick builds: lean startup + cheap model; for long research: retrieval + cache-stable compression; never X with Y"). **Correction (2026-11-10):** combining tactics *has* been studied — Local-Splitter (arXiv 2604.12301) tested 7 tactics in pairs and subsets and found the best set is workload-dependent. What's still open: the popular third-party tools, combined, priced with cache rates, with pass rate, on a real harness and on a subscription. See [atomic-knowledge.md §H](atomic-knowledge.md#h-combining-levers-the-angle-you-asked-about) |

So the order is #1 (benchmark) first. It turns "the perfect chemistry" from a guess into a table, and the tool that applies it (router + planner + chosen parts) comes second, as a thin layer over existing tools rather than a rewrite.

## Sources

| Key | Source |
|---|---|
| [E1] | JetBrains AI blog, caveman paired A/B (2026-07): https://blog.jetbrains.com/ai/2026/07/speak-to-ai-agents-like-cavemen-tosave-tokens/ ; coverage: InfoWorld, https://www.infoworld.com/article/4193775/talk-like-a-caveman-prompts-save-tokens-but-far-less-than-promised.html |
| [E2] | JetBrains AI blog, rtk skill trial (2026-07): https://blog.jetbrains.com/ai/2026/07/rtk-claude-code-token-savings/ |
| [E3] | JetBrains AI blog, ponytail tested (2026-07): https://blog.jetbrains.com/ai/2026/07/ponytail-skill-claude-tested/ (403 to our fetcher; figures via search summary, check before quoting) |
| [E4] | 500-session replay, codepointer (2026-06): https://codepointer.dev/p/cutting-llm-token-costs-with-rtk ; summary: https://capitalandcompute.net/blog/claude-code-token-saving-tools-rtk-headroom-caveman/ (one person's data, rtk/caveman estimated from published rates) |
| [E5] | TokenEconomizer README and project page: https://github.com/microsoft/TokenEconomizer , https://tokeneconomizer.github.io |
| [E6] | Other comparisons found, not yet read: mindstudio.ai/blog/claude-token-saving-plugins-tested · computingforgeeks.com/reduce-claude-code-token-usage-tools · pasqualepillitteri.it/en/news/7881 · caveman.so/news/caveman-vs-rtk-headroom-context-mode (vendor) |
| [B] | BranchWork PR #107 (ledger rows 32–37), issue #116 (startup tokens), issue #117 (direction) |

## Not done yet

1. Stars measure attention, not use: no download counts yet (npm/PyPI give those; context-mode quotes 683k npm).
2. Discovery is GitHub-first: closed products (Compresr, The Token Company) and non-GitHub tools are thin here. Compresr's public repos have under 10 ⭐.
3. Only READMEs read, not code. Features are as described.
4. DeepSeek Harness (`dsh-*`) plugins form a separate Chinese ecosystem (awesome-dsh-plugin, 23.7k ⭐) not surveyed here.
