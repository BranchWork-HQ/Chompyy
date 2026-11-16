# Feature inspiration: 100 open-source projects, 10 per Chompyy section

For each section of [FEATURES.md](../FEATURES.md), ten GitHub projects and the one or two ideas worth taking from each. Collected 2026-11-14. Stars and licences come from the GitHub API that day. Features are as described in each project's README or description; their code wasn't read.

**Licence note:** MIT and Apache-2.0 code can be reused with its notice kept. For AGPL, GPL or unclear licences (marked ⚠️), take the **idea only**, not the code.

## Top picks

The ideas that would change Chompyy the most, from across all sections:

| # | Idea | From | Section |
|---|---|---|---|
| 1 | **Never spill into paid extra usage**: close the gate when a window is at 100% and requests would draw extra credits | cship | 2 |
| 2 | **Learn your away times from a usage heatmap** (by weekday and hour) and propose away windows | AgentLimits | 1 |
| 3 | **Auto-detect "away"** from screen lock, sleep or idle instead of waiting for `/away` | Hammerspoon | 9 |
| 4 | **Run cards when the laptop is closed**: on your own GitHub Actions or a cloud sandbox | claude-code-action, E2B | 5 |
| 5 | **Cards as plain `.md` files** with acceptance criteria, so the blueprint is editable before approval | Backlog.md | 3 |
| 6 | **Blueprint declares its file boundary**, and the sandbox only allows writes there | cc-sdd | 4 |
| 7 | **Circuit breaker** that stops a runaway loop, plus a two-condition "done" check | ralph-claude-code | 5 |
| 8 | **Background memory consolidation** (sleep-time agents): the model for the nightly taste distiller | Letta | 7 |
| 9 | **`<private>` tags and progressive disclosure** (index → timeline → details) for the cold start and taste loading | claude-mem | 7 |
| 10 | ~~**Run two variants of a card overnight** and let the user pick the better one~~ (dropped 2026-11-15: doubles tokens and review time) | Crystal (Nimbalyst) | 3 |
| 11 | **Per-model weekly limits** (7-day Opus vs Sonnet) in the gate | Usage4Claude | 2 |
| 12 | **Urgency score** combining due date, priority, age and tags: a proven model for card priority | Taskwarrior | 3 |

**Also picked on review (2026-11-15):** Claude-Code-Usage-Monitor (forecast, flipped to "unused at reset"), sniffly (where the agent gets stuck), claude-pace (signed pace delta), claude-code-usage-bar (cache countdown, display only), claude-codex-battery (as a cookie that gets eaten), spec-kit and OpenSpec (constitution, change proposals), 12-factor-agents (contact the human, resume), container-use (container isolation), aider (commit per step, repo map), pr-agent (structured result), graphiti (validity periods, without the graph database), Tauri (Windows and Linux). Added for diagram-first users: [cathrynlavery/diagram-design](https://github.com/cathrynlavery/diagram-design) (67.3k ⭐, MIT; 45 diagram types as self-contained HTML + SVG, for Claude Code, Codex, Cursor and others), Mermaid and markmap (both MIT). All now in [FEATURES.md](../FEATURES.md).

---

## 1. Foundation: spend tracking and usage data

What Chompyy needs: per-project, per-task spend across tools; data to learn your patterns from.

| Project | ⭐ | Licence | Idea to take | For Chompyy |
|---|---|---|---|---|
| [ccusage/ccusage](https://github.com/ccusage/ccusage) | 19.4k | ⚠️ unclear | Reports from Claude Code's local JSONL by day, month and session, plus a **5-hour block view** with a live projection | The block view is exactly the window Chompyy plans for; reading local files needs no login |
| [Maciek-roboblog/Claude-Code-Usage-Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) | 8.8k | MIT | Real-time monitor that **predicts when you'll run out** and warns you | Flip it: predict how much will be **left unused** at reset, and offer cards |
| [Piebald-AI/splitrail](https://github.com/Piebald-AI/splitrail) | 229 | MIT | Fast, real-time tracker across many agents (Claude Code, Codex, Copilot, OpenCode, Pi…) | A second reference for multi-agent readers next to codeburn |
| [junhoyeo/tokscale](https://github.com/junhoyeo/tokscale) | 5.9k | MIT | Terminal UI with filtering by platform; a global leaderboard | Filter the report and dashboard by agent |
| [chiphuyen/sniffly](https://github.com/chiphuyen/sniffly) | 1.3k | MIT | Dashboard with an **error breakdown** (where the agent fails) and message-history analysis | Cold start: find tasks the user abandoned or that kept failing, as suggested cards |
| [langfuse/langfuse](https://github.com/langfuse/langfuse) | 37.4k | ⚠️ mixed | Traces per run, evals, built on OpenTelemetry | Treat each card run as a trace: steps, tokens, outcome |
| [Helicone/helicone](https://github.com/Helicone/helicone) | 6.3k | Apache-2.0 | One-line proxy that logs cost per request | Shows per-request cost logging; Chompyy should avoid a proxy (prompt-cache and terms risks) |
| [openlit/openlit](https://github.com/openlit/openlit) | 3.1k | Apache-2.0 | OpenTelemetry-native cost and usage tracking | Claude Code can export OpenTelemetry events: exact per-run usage without parsing logs |
| [sculptdotfun/viberank](https://github.com/sculptdotfun/viberank) | 121 | MIT | Shareable leaderboard built on ccusage data | A shareable "tokens rescued this month" card, for word of mouth |
| [Nihondo/AgentLimits](https://github.com/Nihondo/AgentLimits) | 70 | MIT | macOS widgets with limits, cost and a **usage heatmap** | **Top pick**: the heatmap reveals when you're usually away, so Chompyy can propose away windows |

## 2. Quota and pacing

What Chompyy needs: accurate limits, pace, and never spending money the user didn't plan to.

| Project | ⭐ | Licence | Idea to take | For Chompyy |
|---|---|---|---|---|
| [Astro-Han/claude-pace](https://github.com/Astro-Han/claude-pace) | 243 | MIT | **Signed pace delta**: `⇣15%` green = headroom, `⇡15%` red = burning too fast; pure Bash, one file | Show the weekly gate as a signed delta in the status line, instantly readable |
| [f-is-h/Usage4Claude](https://github.com/f-is-h/Usage4Claude) | 420 | MIT | 5-hour, 7-day, extra usage, and **7-day Opus and Sonnet** limits separately | **Top pick**: the gate should check the limit of the model the card will run on |
| [leeguooooo/claude-code-usage-bar](https://github.com/leeguooooo/claude-code-usage-bar) | 391 | MIT | **Prompt-cache countdown** (`❄ 4m23s` until the next turn pays full price); background daemon, < 1% CPU | Ties to card A5: start away cards while the cache is still warm |
| [Haleclipse/CCometixLine](https://github.com/Haleclipse/CCometixLine) | 3.6k | ⚠️ none | Fast status line in Rust | Status line speed matters; a single binary has no runtime |
| [vdsmon/claude-warmup](https://github.com/vdsmon/claude-warmup) | 182 | MIT | Starts the 5-hour window early so it resets when you need it | Relevant but **check provider terms first** (flagged in BranchWork #111) |
| [ADM-NKH/claude-blitz](https://github.com/ADM-NKH/claude-blitz) | 6 | MIT | Pre-reset backlog runner, **in parallel** before the reset | For the last-hour trigger: run 2–3 small cards in parallel, not one at a time |
| [dennykim123/claude-codex-battery](https://github.com/dennykim123/claude-codex-battery) | 103 | MIT | Limits shown as **battery icons** | A familiar mental model for the menu bar: "battery to use before it resets" |
| [jordan-edai/codex-reset-watcher](https://github.com/jordan-edai/codex-reset-watcher) | 105 | MIT | Watches Codex resets and reset credits | Notify at reset; a starting point for Codex limits |
| [stephenleo/cship](https://github.com/stephenleo/cship) | 432 | Apache-2.0 | `{pace}` headroom; `⚡` when a window is at 100% and **requests draw extra credits**; TOML themes | **Top pick**: never let away runs spill into paid extra usage |
| [rz1989s/claude-code-statusline](https://github.com/rz1989s/claude-code-statusline) | 480 | MIT | Flexible layouts, real-time cost, MCP monitoring, themes | Let users choose what the 🍪 line shows |

## 3. The board and capturing ideas

What Chompyy needs: a board people enjoy, fast capture, sensible priority.

| Project | ⭐ | Licence | Idea to take | For Chompyy |
|---|---|---|---|---|
| [BloopAI/vibe-kanban](https://github.com/BloopAI/vibe-kanban) | 28.7k | Apache-2.0 | Kanban for coding agents: each task in its own worktree, review the diff, any agent | The reference for the board UI in the menu bar or dashboard |
| [MrLesk/Backlog.md](https://github.com/MrLesk/Backlog.md) | 7.4k | MIT | Every task a plain `.md` file; **acceptance criteria and a Definition of Done**; terminal board plus `board export` reports; local-first | **Top pick**: store cards (and blueprints) as `.md` files so editing a blueprint is just editing a file |
| [eyaltoledano/claude-task-master](https://github.com/eyaltoledano/claude-task-master) | 28.4k | ⚠️ custom | Breaks a PRD into tasks with dependencies and a **complexity analysis**; `next` picks the next task | Complexity → cost range in the blueprint; a `next` for `/eat-tokens` |
| [smtg-ai/claude-squad](https://github.com/smtg-ai/claude-squad) | 8.8k | ⚠️ AGPL | Several agents in tmux sessions and worktrees, with a background auto-yes mode | Idea only: one place to watch several running cards |
| [stravu/crystal](https://github.com/stravu/crystal) (now Nimbalyst) | 3.1k | MIT | Parallel sessions in worktrees to **compare approaches** | **Top pick**: run two variants of a card overnight, user picks the better one |
| [starsh2001/qlaude](https://github.com/starsh2001/qlaude) | 23 | MIT | Queue tasks, walk away, **Telegram ping when it needs you** | Ping the phone when a card writes `QUESTIONS.md` |
| [GothenburgBitFactory/taskwarrior](https://github.com/GothenburgBitFactory/taskwarrior) | 6.2k | MIT | **Urgency score** from due date, priority, age and tags, each with a tunable weight | **Top pick**: a proven formula behind the token-value priority idea |
| [todotxt/todo.txt-cli](https://github.com/todotxt/todo.txt-cli) | 6.2k | ⚠️ GPL | One-line plain-text tasks with `+project` and `@context` | Fast `/later` syntax: `/later add tests +parser @tonight` |
| [aaif-goose/goose](https://github.com/aaif-goose/goose) | 56.6k | Apache-2.0 | **Recipes**: reusable, shareable workflow files, which can be scheduled | Routine cards: a repeated card becomes a recipe that runs without questions |
| [jesseduffield/lazygit](https://github.com/jesseduffield/lazygit) | 83.9k | MIT | Keyboard-driven terminal UI | A keyboard-first `chompyy board` in the terminal |

## 4. Blueprint (spec before the run)

What Chompyy needs: a short, checkable scope that keeps the agent on target.

| Project | ⭐ | Licence | Idea to take | For Chompyy |
|---|---|---|---|---|
| [github/spec-kit](https://github.com/github/spec-kit) | 149.8k | MIT | Spec → plan → tasks phases, with a **constitution** of project principles | The constitution is the project section of taste.md, fed into every blueprint |
| [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) | 74.8k | MIT | Each change is a proposal with tasks and **spec deltas**, archived when done | A blueprint as a small change proposal; keep finished ones as history for cost ranges |
| [bmad-code-org/BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) | 55.4k | ⚠️ unclear | Planning split across roles (analyst, PM, architect) | Lighter version: one "reviewer" pass on the blueprint before approval |
| [buildermethods/agent-os](https://github.com/buildermethods/agent-os) | 5.6k | MIT | Injects codebase **standards** into specs | Inject the relevant taste lines into the blueprint prompt |
| [gotalab/cc-sdd](https://github.com/gotalab/cc-sdd) | 3.8k | MIT | **Boundary-first**: tasks carry `_Boundary:_` (files) and `_Depends:_`; discovery decides spec vs direct; a fresh implementer per task with TDD | **Top pick**: the blueprint lists the files it may touch, and the sandbox allows writes only there |
| [Pimzino/spec-workflow-mcp](https://github.com/Pimzino/spec-workflow-mcp) | 4.3k | ⚠️ GPL | Spec workflow with a real-time **approval dashboard** | Idea only: approve blueprints from a dashboard or menu bar |
| [snarktank/ai-dev-tasks](https://github.com/snarktank/ai-dev-tasks) | 7.8k | Apache-2.0 | Minimal PRD → task list in markdown, one sub-task at a time | Keep blueprints this light |
| [humanlayer/humanlayer](https://github.com/humanlayer/humanlayer) | 12.9k | Apache-2.0 | Research → plan → implement; humans approve high-stakes steps | A short research step before the blueprint for unfamiliar repos |
| [humanlayer/12-factor-agents](https://github.com/humanlayer/12-factor-agents) | 27.2k | ⚠️ unclear | Principles: own your context window, small focused agents, **contact humans as a tool call**, pause and resume | `QUESTIONS.md` is "contact the human"; resume a card after the user answers |
| [coleam00/context-engineering-intro](https://github.com/coleam00/context-engineering-intro) | 13.9k | MIT | PRPs (product requirement prompts) with **validation gates**: commands that must pass | Make "How it's checked" runnable commands that the report runs |

## 5. Away runs

What Chompyy needs: safe, unattended runs that stop when something goes wrong, ideally even with the laptop closed.

| Project | ⭐ | Licence | Idea to take | For Chompyy |
|---|---|---|---|---|
| [dagger/container-use](https://github.com/dagger/container-use) | 4.1k | Apache-2.0 | Each agent in its own **container plus git branch**; inspect with log and diff, then merge | A stronger isolation option than the OS sandbox |
| [anthropics/sandbox-runtime](https://github.com/anthropics/sandbox-runtime) | 7.1k | Apache-2.0 | The library behind Claude Code's sandbox: filesystem and network rules for **any process** | Wrap Codex or cursor-agent runs in the same sandbox: one safety model for all agents |
| [e2b-dev/E2B](https://github.com/e2b-dev/E2B) | 14.9k | Apache-2.0 | Secure cloud sandboxes for agents | **Top pick**: run cards in the cloud when the laptop is closed (the bus problem) |
| [OpenHands/OpenHands](https://github.com/OpenHands/OpenHands) | 93.5k | MIT | Headless runs in a Docker runtime; resolves issues into PRs | Issues as a card source |
| [imbue-ai/sculptor](https://github.com/imbue-ai/sculptor) | 246 | MIT | Isolated workspaces per agent; a **Changes** view to review and commit; choice of harness | The review step in the menu bar or dashboard |
| [anthropics/claude-code-action](https://github.com/anthropics/claude-code-action) | 9.9k | MIT | Runs Claude Code inside GitHub Actions | **Top pick**: away runs on the user's own GitHub runners, so they keep going with the laptop shut (check how it authenticates with a subscription) |
| [yail259/overnight](https://github.com/yail259/overnight) | 12 | MIT | Queue tasks, run overnight, wake up to results | Same core idea, minimal; confirms the need |
| [frankbria/ralph-claude-code](https://github.com/frankbria/ralph-claude-code) | 9.7k | MIT | **Circuit breaker** against runaway loops; **two-condition exit** (completion signs and an explicit signal); session expiry | **Top pick**: stop a card that loops or keeps failing |
| [AnandChowdhary/continuous-claude](https://github.com/AnandChowdhary/continuous-claude) | 1.4k | MIT | Loop that opens PRs, **waits for CI**, then merges | Use tests or CI as the checker (Chompyy still never merges by itself) |
| [openai/codex](https://github.com/openai/codex) | 135.2k | Apache-2.0 | Named **sandbox modes** (read-only, workspace-write, full access) and approval policies | Let users pick a named safety level per card |

## 6. Report, review and rating

What Chompyy needs: fast review, easy keep or undo, honest summaries.

| Project | ⭐ | Licence | Idea to take | For Chompyy |
|---|---|---|---|---|
| [Aider-AI/aider](https://github.com/Aider-AI/aider) | 50.1k | Apache-2.0 | Commits every change with a descriptive message; **`/undo`** reverts the last one | Good commit messages per card; undo a single commit, not only the whole card |
| [gitbutlerapp/gitbutler](https://github.com/gitbutlerapp/gitbutler) | 22k | ⚠️ unclear | Virtual branches: several applied at once; an undo timeline | Idea only: try several cards' results together before keeping them |
| [jj-vcs/jj](https://github.com/jj-vcs/jj) | 32.5k | Apache-2.0 | **Operation log** and `jj undo` for any operation | Make `keep` undoable through Chompyy, not just a printed git hint |
| [RonitSachdev/ccundo](https://github.com/RonitSachdev/ccundo) | 1.4k | ⚠️ unclear | Granular undo of Claude Code file operations from session logs (now native as checkpoints) | Partial undo: keep some files, drop others |
| [The-PR-Agent/pr-agent](https://github.com/The-PR-Agent/pr-agent) | 16.1k | MIT | Structured PR descriptions: type, summary, walkthrough | A structured result for `show` |
| [dandavison/delta](https://github.com/dandavison/delta) | 32.7k | MIT | Syntax-highlighted, side-by-side diffs | `chompyy diff` pipes through delta when it's installed |
| [Wilfred/difftastic](https://github.com/Wilfred/difftastic) | 26.2k | MIT | Structural diffs that understand syntax | Same; clearer diffs for code cards |
| [arxanas/git-branchless](https://github.com/arxanas/git-branchless) | 4.1k | Apache-2.0 | `git undo` and a **smartlog** graph | A smartlog-style view of all `chompyy/*` branches |
| [jesseduffield/lazygit](https://github.com/jesseduffield/lazygit) | 83.9k | MIT | Stage individual hunks interactively | "Keep part of it": pick hunks from a card's branch |
| [anomalyco/opencode](https://github.com/anomalyco/opencode) | 226.8k | MIT | Session undo and redo; share a session link | Redo after undo; share a card's result with a teammate |

## 7. Taste and memory

What Chompyy needs: a visible taste.md, learned carefully, loaded cheaply, with secrets kept out.

| Project | ⭐ | Licence | Idea to take | For Chompyy |
|---|---|---|---|---|
| [mem0ai/mem0](https://github.com/mem0ai/mem0) | 69k | Apache-2.0 | Memory with **user, session and agent scopes**; add, update, forget | The scoping model for taste (everywhere / project / task type) |
| [letta-ai/letta](https://github.com/letta-ai/letta) | 25.4k | Apache-2.0 | Editable memory blocks; **sleep-time agents** that consolidate memory in the background | **Top pick**: the model for the nightly taste distiller |
| [getzep/graphiti](https://github.com/getzep/graphiti) | 32.8k | Apache-2.0 | Temporal knowledge graph: facts get **validity periods** and are invalidated, not deleted, when contradicted | "Removed when contradicted", keeping the history of why |
| [basicmachines-co/basic-memory](https://github.com/basicmachines-co/basic-memory) | 4.6k | ⚠️ AGPL | Memory as plain markdown files the user edits (Obsidian-compatible) | Idea only: confirms taste.md as a user-editable file |
| [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) | 117k | Apache-2.0 | Compact index at session start, **progressive disclosure** (index → timeline → details); **`<private>` tags** never stored; choose what gets injected | **Top pick**: privacy tags for the cold start; load taste in layers to save tokens |
| [topoteretes/cognee](https://github.com/topoteretes/cognee) | 33.3k | Apache-2.0 | Long-term memory with **small models**, free | Run the distiller on a cheap or local model |
| [supermemoryai/supermemory](https://github.com/supermemoryai/supermemory) | 31.6k | MIT | Memory engine that can run fully locally | Local-first, matching the privacy notice |
| [microsoft/TokenEconomizer](https://github.com/microsoft/TokenEconomizer) | 6.1k | Apache-2.0 | Micro-skills **confirmed over 3 sessions**, dropped on contradiction; a judge-checked loop redirect | The source of the 3-confirmation rule (research card G2) |
| [agiresearch/A-mem](https://github.com/agiresearch/A-mem) | 1.2k | MIT | Linked notes that update each other as new ones arrive | Related preferences refine each other instead of piling up |
| [cline/cline](https://github.com/cline/cline) | 71.6k | Apache-2.0 | **Memory Bank**: structured markdown files the agent reads at start; Plan and Act modes | A fixed structure for taste.md and project facts |

## 8. Optimization (second priority)

What Chompyy needs: savings that don't break the prompt cache, chosen per task type.

| Project | ⭐ | Licence | Idea to take | For Chompyy |
|---|---|---|---|---|
| [rtk-ai/rtk](https://github.com/rtk-ai/rtk) | 86.5k | Apache-2.0 | Per-command output filters applied **before history**; Rust, < 10 ms | Cache-safe compression for away runs (borrow, don't rebuild) |
| [headroomlabs-ai/headroom](https://github.com/headroomlabs-ai/headroom) | 79.6k | Apache-2.0 | **CacheAligner** flags a volatile prefix; reversible compression | Lint the startup prompt; keep originals retrievable |
| [microsoft/LLMLingua](https://github.com/microsoft/LLMLingua) | 6.8k | MIT | Token-level prompt compression, up to 20× on prose | Only for prose (e.g. research digests); it breaks code and agents (card C1) |
| [yamadashy/repomix](https://github.com/yamadashy/repomix) | 29.3k | MIT | Packs a repo into one file with token counts; compressed mode keeps signatures | Give the blueprint model a cheap map of the repo |
| [oraios/serena](https://github.com/oraios/serena) | 31.4k | ⚠️ unclear | Symbol-level retrieval and editing via language servers | Read a symbol instead of a whole file |
| [musistudio/claude-code-router](https://github.com/musistudio/claude-code-router) | 38.1k | MIT | Routes by task type (background, thinking, long context) | A "background" route: cheap model for routine away cards |
| [mksglu/context-mode](https://github.com/mksglu/context-mode) | 34.1k | ⚠️ unclear | Keeps tool output out of context; stores it and searches it on demand | Big outputs go to a file, the agent searches them |
| [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) | 119.8k | Apache-2.0 | Terse output; **keep-warm decided by your return pattern** | Keep the cache warm only when history says you'll be back |
| [alexgreensh/token-optimizer](https://github.com/alexgreensh/token-optimizer) | 3k | ⚠️ custom | Checkpoint before compaction, restore after; ghost-token audit | Survive compaction in long cards; audit the startup |
| [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) | 190.6k | MIT | A **quality floor** of what may never be cut; YAGNI ladder | A "never cut" list in the blueprint (validation, security, tests) |

## 9. Interfaces

What Chompyy needs: a menu bar for non-terminal users, calendar awareness, automatic "away" detection.

| Project | ⭐ | Licence | Idea to take | For Chompyy |
|---|---|---|---|---|
| [steipete/CodexBar](https://github.com/steipete/CodexBar) | 23.2k | MIT | One menu bar item per provider, or merged; incident badges; reuses existing logins, stores no passwords | Foundation for limits and the menu bar |
| [getagentseal/codeburn](https://github.com/getagentseal/codeburn) | 11.8k | MIT | Swift menu bar that calls the CLI; **localized** (incl. Traditional Chinese); one-command menu bar install | Ship zh-Hant from day one; `chompyy menubar` installs it |
| [exelban/stats](https://github.com/exelban/stats) | 43.4k | MIT | Modular menu bar widgets, each switchable | Modules: quota, board, last report |
| [jordanbaird/Ice](https://github.com/jordanbaird/Ice) | 30k | ⚠️ GPL | Menu bar manager; menus get crowded | Idea only: one compact item, details in the popover |
| [winfunc/opcode](https://github.com/winfunc/opcode) | 22.5k | ⚠️ AGPL | Claude Code GUI with background agents and a usage dashboard | Idea only: the desktop experience for non-CLI users |
| [siteboon/claudecodeui](https://github.com/siteboon/claudecodeui) | 14.6k | ⚠️ AGPL | Use coding agents from **phone and web** | Idea only: approve cards and answer questions from your phone |
| [insanum/gcalcli](https://github.com/insanum/gcalcli) | 3.8k | MIT | Google Calendar from the terminal (agenda and more) | A simple path to the calendar feature |
| [pimutils/khal](https://github.com/pimutils/khal) | 3.1k | MIT | Calendar from local CalDAV or `.ics` files | Support non-Google calendars, locally |
| [Hammerspoon/hammerspoon](https://github.com/Hammerspoon/hammerspoon) | 16.4k | MIT | macOS automation hooks for screen lock, sleep and idle | **Top pick**: start approved cards automatically when you lock the screen |
| [tauri-apps/tauri](https://github.com/tauri-apps/tauri) | 112.9k | Apache-2.0 | Small cross-platform desktop apps with a web UI | An option for Windows and Linux beyond Swift |

## 10. Hardening and measurement

What Chompyy needs: proof the savings are real, and safety on every platform.

| Project | ⭐ | Licence | Idea to take | For Chompyy |
|---|---|---|---|---|
| [SWE-bench/SWE-bench](https://github.com/SWE-bench/SWE-bench) | 6.2k | MIT | Real GitHub issues with tests as ground truth | A fixed task set for paired replays |
| [harbor-framework/terminal-bench-1](https://github.com/harbor-framework/terminal-bench-1) | 2.6k | Apache-2.0 | Terminal tasks checked by tests in containers | Realistic away-run tasks to measure |
| [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo) | 27.2k | MIT | Declarative tests comparing prompts and models; **red teaming** | Test blueprint prompt variants; red-team the safety prompt and sandbox |
| [UKGovernmentBEIS/inspect_ai](https://github.com/UKGovernmentBEIS/inspect_ai) | 3.2k | MIT | Eval framework with sandboxed tools and a log viewer | Harness for "with skill vs without" replays |
| [openai/evals](https://github.com/openai/evals) | 19.7k | ⚠️ unclear | A registry format for evals | Store replay tasks in a shareable format |
| [sharkdp/hyperfine](https://github.com/sharkdp/hyperfine) | 29.3k | Apache-2.0 | Benchmarks with warm-up runs and statistics | Report savings with ranges and repeat runs, not single numbers |
| [containers/bubblewrap](https://github.com/containers/bubblewrap) | 9.5k | ⚠️ LGPL-style | The Linux sandbox behind Claude Code's sandbox on Linux | Required for Linux support; check it's installed |
| [netblue30/firejail](https://github.com/netblue30/firejail) | 7.7k | ⚠️ GPL | Linux sandbox with seccomp profiles | Idea only: an alternative where bubblewrap isn't available |
| [Aider-AI/polyglot-benchmark](https://github.com/Aider-AI/polyglot-benchmark) | 228 | ⚠️ none | The coding problems from aider's polyglot benchmark | Already used in branchwork#107; reuse for cost-per-solved-task |
| [EleutherAI/lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness) | 14.5k | MIT | Standard, reproducible eval setup | Conventions for reproducible measurement |
