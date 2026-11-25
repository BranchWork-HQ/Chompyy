# Chompyy features

Everything Chompyy does or is planned to do, in one list to build from. Collected from the [spec](research/spec-token-utilization.md), the [research](research/atomic-knowledge.md), the shipped CLI ([`cli/`](cli/README.md)), issue #2, and the design conversations. Updated 2026-11-23.

**Status:** ✅ built · 🔜 next · 📋 planned · 💭 idea (not decided)

Ideas from 100 related open-source projects, 10 per section: [research/feature-inspiration.md](research/feature-inspiration.md).

> **The goal:** more finished work per weekly allowance, with less back-and-forth. The main metric is *accepted results from capacity that would have reset unused*, with acceptance rate as the warning sign. Tokens burned on unwanted work don't count.

## Chompyy's shape: three layers (2026-11-19)

```
  ┌───────────────────────────────────────────────────────────────────────────┐
  │ 3. VALUE: what you get, shown as numbers                                  │
  │    work done from capacity that would have reset · $ of API-priced work   │
  │    on your plan · "learned 4 rules; corrections per session 6 → 3"        │
  ├────────────────────────┬─────────────────────────┬────────────────────────┤
  │ 2a. USE THE WINDOW     │ 2b. MONITOR             │ 2c. OPTIMIZE           │
  │ pre-planned cards run  │ spend, limits, growth,  │ chompyy detect: advice │
  │ while you're away (NOW)│ forecast, heatmap       │ that really cuts cost  │
  ├────────────────────────┴─────────────────────────┴────────────────────────┤
  │ 1. CORE: CHOMPYY KNOWS YOU                                                │
  │    evidence → proposal with receipts → your yes → applied → did it work?  │
  └───────────────────────────────────────────────────────────────────────────┘
```

The core is the base everything stands on; the three sides are what Chompyy does; the value layer is how you see that it's worth it.

| Side | What it is | Where in this list | Status |
|---|---|---|---|
| **2a. Use the reset window** | Pre-planned cards run in capacity that would reset unused (overnight, the last hour before a reset) | §3–§6 | ◐ the current focus |
| **2b. Monitoring board** | Spend, limits and trends like CodexBar and codeburn: real numbers, a growth line, the price as API value, the forecast, the premise number and the usage heatmap | §1, §2 | 📋 research first (§1) |
| **2c. Optimization** | `chompyy detect`: Chompyy proactively finds what wastes tokens in your setup and habits and helps fix it, with evidence | §8 | ◐ rulebook done |
| **1. Core: Chompyy knows you** | Learns how you like work done from what you keep, undo, edit, rate and say. Every side feeds it and uses it | §7 | ◐ |
| **3. Value** | The impact as numbers: work from capacity that would have reset, API value of your plan, learning shown as a number | §1, §7, §11 | 📋 |

**One evidence engine for all three sides.** Taste rules and detect findings go through the same steps: evidence → a proposal with its receipts → your yes / not now / never → applied → did it work? A declined piece of advice teaches taste too ("never suggest removing MCP servers"), and the "What Chompyy learned" panel shows both the same way. Built for taste today (§7); detect plugs into it when it lands (§8).

## What makes Chompyy different: taste learned from outcomes

**Normal agents remember what you tell them. Chompyy learns from what you keep.**

**And it shows you the picture first.** Every card opens as a small diagram (goal → what changes → what it won't touch → done when) before any text; the details are one click away, and if the picture missed something you ask Chompyy to redraw it. Picture first is the default way Chompyy explains anything: blueprints, results, the report.

Saving preferences is common now (Claude Code memory, `CLAUDE.md`, ChatGPT memory, `AGENTS.md`). What those can't see is the outcome: whether you kept the result, undid it, rewrote the blueprint, or edited the code afterwards. Chompyy sees all of that, because it runs the work and you review it. So its taste rests on evidence, and it acts on it: what gets suggested and how cards are run while you're away.

| Normal agent memory | Chompyy taste |
|---|---|
| Written when you state something, or when the model guesses it matters | Written from evidence: keep/undo, blueprint edits, edits after keep, ratings, repeated corrections |
| One agent, one vendor | One `taste.md` for every agent (Claude Code, Codex, Cursor, …) |
| Rarely checked or pruned | Each preference shows its evidence, has a valid-from date, and is retired (not deleted) when contradicted |
| Shapes tone in chat | Shapes what work gets done and how |
| Hard to tell if it helps | Measured: keep rate with taste vs without ([§11](#11-proof-evals-and-benchmarks)) |

The moment we design for: *"I noticed you undid 3 cards that added tests you didn't ask for. Stop adding them unless the blueprint says so? [yes / no]"*. Specific, with receipts, and asked rather than assumed. When to write a preference: [§7](#7-taste-and-memory-the-core).

**Why it's defensible: a closed loop.** Away runs create the evidence, the evidence shapes taste, taste picks and shapes the next runs. Taste alone is a feature vendors will copy; taste fed by work Chompyy runs and you review is the loop they don't have.

```
  away runs ──► you review (keep / undo / edit / rate) ──► taste ──► better cards ──┐
      ▲                                                                             │
      └────────────────────────────────────────────────────────────────────────────-┘
```

## Build order at a glance

1. ✅ **Core loop (MVP CLI)**: quota snapshot → board → blueprint → sandboxed away run → action-first report → keep/undo → rating
2. ◐ **Mac app with the card board** (Swift, `mac/`): menu bar cookie + board window; open a card as a picture-first sheet to approve, edit, answer, keep, undo, rate. First version built 2026-11-15, moved ahead so you can test with it sooner
3. ✅ **History cold start** for Claude Code (§5.9): privacy notice → first taste.md + suggested cards, landing in the board (2026-11-17)
4. 📋 **Foundation**: codeburn (spend, 42 tools, optimize, compare, guard) and CodexBar (limits for 114 providers, menu bar) — see [Foundation](#1-foundation-codeburn--codexbar)
5. ✅ **Taste distiller**, triggers (last hour, bedtime), cost ranges, the "while you were away" trends (CLI, 2026-11-17; the Mac app shows taste as a badge and popup since #39, and exact tokens per run; cost ranges are CLI only)
6. ◐ **Optimization side = the Detective** (decided 2026-11-17): find flaws in your setup and habits from local files, using knowledge distilled from the code of rtk, headroom, ponytail, caveman, token-optimizer and codeburn; findings become Advice cards; approved ones are applied while you're away (settings lane: backed-up diff; work lane: sandboxed card); "did it work?" re-measures. Steps: ✅ 1 rulebook ([research/detective/RULEBOOK.md](research/detective/RULEBOOK.md)) · ◐ 2 `chompyy detect` (startup tax + cache, 2026-11-23) · 📋 3 Advice cards · 📋 4 away-run lanes · 📋 5 did-it-work + taste. Also: cache-aware sessions, compression before history
7. 📋 **More agents**: Cursor, Codex history and runners; calendar

---

## 1. Foundation: codeburn + CodexBar

Chompyy stands on two established MIT tools instead of rebuilding what they do well, then adds its own features on top.

| Capability | From | Status in Chompyy |
|---|---|---|
| **Spend tracking** by project, branch, task, PR, model | codeburn (`report`, `overview`, `export --format json`) | 📋 |
| **Works with 42 tools** by reading their session files on disk, no config | codeburn (`src/providers/`, one file per tool) | 📋 (also feeds the history cold start for more agents) |
| **Live limits**: session, weekly, monthly windows with reset countdowns | codeburn's TS readers (`app/electron/quota/`: Claude, Codex, Copilot, Gemini, …) to copy; CodexBar (Swift, 114 providers) to port the rest, e.g. Cursor | 📋 (today: Claude Code only, via the status line ✅). Limits stay in the TS core because the gate must work without the Mac app |
| **Claude limits without a live session**, via the usage endpoint codeburn uses | codeburn (copied to `cli/src/vendor/codeburn/`) | ✅ default since 2026-11-15 (`quotaSource: "api"`); status line stays as the fallback. Undocumented endpoint, so it may change |
| **Plan pacing** | codeburn (`plan`), CodexBar (reset countdowns) | ◐ per-hour pace and weekly stay-on-pace gate ✅ for Claude Code |
| **Menu bar app** (macOS; Linux in CodexBar) | CodexBar, codeburn `mac/` | 📋 |
| **Dashboard** (terminal and web) | codeburn (`report`, `web`) | 📋 |
| **optimize**: find token waste, audit startup costs | codeburn (`optimize`, `context`) | ◐ superseded by the detective: codeburn's 24 checks are one chapter of its [rulebook](research/detective/RULEBOOK.md) |
| **compare** models on your own history | codeburn | 📋 |
| **guard / budgets**: spending caps | codeburn (`budget`) | 📋 |
| **Checks its own fixes** against later sessions | codeburn (`act report`) | ◐ ratings logged ✅; before/after numbers 📋 |
| Provider status and incident badges; don't start away cards during an outage | CodexBar | 📋 |
| **Where the agent gets stuck**: error breakdown and failing or abandoned tasks from history | sniffly (MIT, Python: port the idea) | 📋 also feeds cold-start suggestions |

**Monitoring board, side b (2026-11-19).** Before building, research what's on the market, the same way we did for away runs ([away-readiness.md](research/away-readiness.md)) and optimization ([detective RULEBOOK.md](research/detective/RULEBOOK.md)): read the code of the open-source monitors, not their READMEs, and pick the features worth having.

| Feature | Status | Notes |
|---|---|---|
| **Monitoring research**: read the code of codeburn, CodexBar, AgentLimits, Claude-Code-Usage-Monitor, ccusage, sniffly and similar; one note per tool + a feature pick list | ✅ 2026-11-21 | Output: `research/monitoring/` like `research/detective/`. Decides what we copy (MIT, with credit) → `research/monitoring/PICKS.md` (PR #45). |
| **Spend board**: real numbers per day, project and model, with a growth line | ◐ | Copy codeburn's session readers, pricing table and totals into Chompyy's TS core; draw it in Swift **Ledger ✅ 2026-11-21:** `chompyy usage` reads every request (numbers only), dedupes by message id (a plain sum counted 2.15× on this Mac), prices from codeburn's LiteLLM snapshot with 1-hour cache writes at 1.6× the 5-minute rate (matched Claude Code's recorded cost to the 8th decimal on Haiku and Opus), adds away runs as recorded, keeps rows after Claude Code cleans up its logs, and hides titles outside your ticked workspaces. The board in the app is next. **Board in the app ✅ 2026-11-21:** toolbar **Usage** sheet and the menu bar popover: Trend (14 days, peak and average), Calendar (12 weeks, quartile colours, AgentLimits), Projects and Conversations (this week, titles only for ticked workspaces), each in tokens or API value. |
| **Usage window** (codeburn-style dashboard, rebuilt in Swift): a sidebar with Overview, Conversations, Pull requests, Projects & models and Optimize; Today / 7D / 30D / Month; tokens or API value | ✅ 2026-11-21 | Overview: Today (yesterday, 7-day average, vs yesterday), This month (vs the same days last month, on-pace projection, plan multiple), the 12-week calendar, what the work was, day by day. Opens from the board's Usage button and the menu bar's Conversations / All usage links. Taken from codeburn's layout; their plugins, export, model compare, streaks and efficiency score left out (the score belongs in detect, with reasons) |
| **What the work was**: Coding, Running commands, Reading code, Research, Delegating, Planning, Conversation | ✅ 2026-11-21 | Judged from the tools each request called, so it works in any language and reads no text (codeburn guesses from the English words of your prompt) |
| **Cost per pull request**: what a conversation spent from its previous PR (or its start) until it opened each one | ✅ 2026-11-21 | From Claude Code's `pr-link` rows (written many times each: 2,084 rows, 115 distinct on the first Mac); a PR only mentioned with no work before it is left out. Opens the PR or its conversation |
| **One conversation, turn by turn** (pillar A, like a Langfuse trace): click a conversation in Usage to see each turn's cost, the context size request by request (it grows, and drops at compactions), the tools each request used and how much each brought back, and "what ate the tokens" | ✅ 2026-11-21 | `chompyy trace <id>`; a subset of codeburn's `sessions --why` (MIT): turns → requests → tools, cost by token kind, and two estimates, **carry** (a big result re-read until the next compaction) and **prefix** (the startup context every request re-reads). Estimates are grounded in what was recorded: a result is capped at what the next request actually wrote to the cache, and images count as images (~1.6k tokens), not as their base64 text (that bug made screenshots look like $70 of a $48 conversation). Prompts show only for ticked workspaces. Next: detect findings pinned to the turn they came from |
| **Price as API value** for subscription users: "your $200 plan did $1,400 of API-priced work this month" | ✅ | Fits "use what you pay for"; never quote dollar *savings* to subscription users (token-optimizer's rule) **✅ 2026-11-21:** the Usage window's This month card: "12.7× your Pro plan's $20 so far · on pace for 18.4×", from list plan prices (Pro $20, Max 5x $100, Max 20x $200) or yours via `chompyy plan-price`. |
| **Forecast, premise and heatmap together**: when the window will run out or reset unused; what share of your windows reset with capacity left; a weekday × hour heatmap of when you use Claude, which also proposes away windows | 📋 | Forecast ✅ in §2; heatmap from AgentLimits; the premise number from §11 shown as a feature |

**How to combine them: decided 2026-11-14: option D**, copy codeburn's TypeScript code and port the CodexBar providers we need, with credit. No extra installs for users. What each tool does and which language each part is in: [research/foundation-codeburn-codexbar.md](research/foundation-codeburn-codexbar.md).

| Option | Gains | Costs |
|---|---|---|
| **A. Integrate through their CLIs** | Chompyy calls `codexbar` for limits and `codeburn export --format json` for spend. Both projects keep shipping fixes and new providers; we own none of their code | Users install two extra tools (Chompyy can do it for them); less control over their output format |
| **D. Copy codeburn's readers, port only the CodexBar providers we need** (recommended) | One self-contained Chompyy, no extra installs. codeburn is TypeScript like Chompyy, so its readers copy almost directly; start with Claude, Codex, Cursor limits instead of all 114 | We track their updates and copy fixes ourselves; porting Swift providers to TypeScript takes work |
| B. Fork one as the base (codeburn: TypeScript + Swift menu bar, same stack as Chompyy) | Full control, one install | We maintain an 11.8k-star codebase and merge its updates ourselves; Chompyy becomes "a codeburn fork" in positioning |
| C. Fork both | Everything in one app | Two very active codebases in two languages (CodexBar alone is ~38 MB of Swift) to keep in sync; much slower to ship our own features |

Licence duty for anything copied: keep the MIT notices (a `THIRD_PARTY_NOTICES` file, as codeburn does).

## 2. Quota and pacing

| Feature | Status | Notes |
|---|---|---|
| Quota snapshot from Claude Code's status line (`rate_limits.five_hour` / `.seven_day`) | ✅ | Documented fields; saved to `~/.chompyy/quota.json` because they only exist inside a live session |
| `chompyy status`: % left, time to reset, per-hour pace, weekly used, stale or not | ✅ | Pace shown as "% per hour available", an option rather than pressure |
| Never probe quota by sending a message | ✅ | The first message would start a new 5-hour window |
| Unknown or stale quota blocks away runs (`--force` overrides) | ✅ | Running would start a new window, not use leftover |
| **Weekly stay-on-pace gate**: run only while behind an even pace through the week | ✅ | Decided 2026-11-14; never borrows from later days |
| Weekly hard stop at 90% used | ✅ | Whatever the pace |
| 5-hour minimum left before starting a card | ✅ | Default 10% |
| **Rolling daily allowance** shown as an "on pace / ahead / behind" bar: `today = remaining weekly ÷ days left` | ◐ | Shown ✅ (2026-11-17) in `chompyy status` and the app JSON; day ends at your bedtime; no verdict until a reading from before today exists. The gate still uses the weekly even pace; "unspent allowance funds the night" in the gate 📋 |
| Weighting days by your own usage pattern (e.g. light weekends) | 💭 | Deferred as an advanced feature |
| **Signed pace delta** in the status line: `⇣15%` green = headroom, `⇡15%` red = burning fast | ✅ | 2026-11-17, 5h and 7d. claude-pace (MIT, one Bash file); readable at a glance |
| **Forecast unused at reset**: "~40% of this window will reset unused at 18:20", the moment to offer cards | ✅ | 2026-11-17: from the last hour of quota readings (`quota-history.json`), else the window's average; or "limit ~20:24" when the limit comes first. Offering cards at that moment 📋. Claude-Code-Usage-Monitor (MIT) forecasts run-out; we flip it. CodexBar's unused-quota reset warning is the same trigger |
| Freeze the forecast once a limit is hit (no fake projections) | ✅ | "limit hit, resets 18:20". Claude-Code-Usage-Monitor |
| **Never spill into paid extra usage**: close the gate at 100% even if extra credits would allow more | ✅ | 2026-11-17: closes at 100% of the 5h or weekly window whatever the settings say; checked before each card (a card already running isn't stopped mid-way). cship |
| **Per-model weekly limits** (e.g. Opus 7-day vs all models) in the gate | ✅ | 2026-11-17: read from the usage endpoint, shown in `status`; the gate checks the run's model (with `runModel` unset: closes at 100% of any, notes the rest). Usage4Claude |
| **Learn your away times** from a weekday × hour usage heatmap and propose away windows | 📋 | AgentLimits Note 2026-11-21 (research/monitoring): AgentLimits' heatmap is a daily calendar (now in Usage); the weekday × hour grid comes from codeburn's Punchcard idea. |
| **Prompt-cache countdown** (`❄ 4m23s` until the next turn pays full price) | 💭 | claude-code-usage-bar (MIT). Display only; no automatic keep-alive pings without checking provider terms |
| Limits for other agents and providers | 📋 | Via CodexBar (Foundation) |

## 3. The board and capturing ideas

| Feature | Status | Notes |
|---|---|---|
| Board columns: suggested · later · approved · running · review · done | ✅ | Only allowed moves; a card can't be approved without a blueprint |
| `chompyy later "<idea>"`: park a stray idea without switching tasks | ✅ | Blueprint drafted in the background |
| `board`, `show`, `approve`, `drop` (archived, not deleted) | ✅ | |
| `chompyy eat-tokens`: leftover window plus the cards you could run (read-only) | ✅ | |
| **"+" on the Later column** opens the Park-an-idea box, empty, cursor in the text field | ✅ | 2026-11-19, card #10 |
| **Draft all**: one button (and `chompyy blueprint --all-later`) drafts every Later card with no blueprint; waits for quota like background drafting | ✅ | 2026-11-19, card #21 (+ #20's quota rule) |
| **Cards wait visibly for quota**: with 0% left, a Later card says "waiting for quota" and drafts after the reset instead of looking stuck; running out mid-draft retries after the reset, not marked failed | ✅ | 2026-11-19, card #20 |
| **Workspaces**: each card records the branch it was created on; the board groups cards under one header per workspace; each card has its own folder (`~/.chompyy/cards/<workspace>/<id>/`) for its blueprint and logs | ✅ | 2026-11-19, card #19 |
| **Learn which cards you approve**: what you approve vs drop from suggestions says what kind of work you want Chompyy to pick; used to rank future suggestions (a separate taste from how you like work done) | 📋 | 2026-11-19. Dropped drafts don't teach *how* to work, but they do teach *what* to suggest |
| **Suggested cards on request only** (no automatic pushes) | 📋 | The more you ask, the more it prepares; cap and expire stale ones |
| Suggestions from history: unfinished ideas, "let's do that later", TODOs the agent left, abandoned tasks, routines repeated 3+ times | ✅ | Cold start; each card must quote what you said, checked against the digest |
| Suggestions related to what you're working on now | 📋 | |
| Review cards while waiting: during a long run, show 1–2 cards to approve instead of scrolling | 📋 | Only during waits over ~1 minute, never while typing |
| Stale-card expiry | ✅ | 2026-11-17: suggested cards untouched for `suggestedExpiryDays` (14) are archived; your own parked ideas never expire |
| **Cards as plain `.md` files** with acceptance criteria, editable in any editor | 📋 | Backlog.md; `board.json` becomes an index |
| **Urgency score** to order cards: due date, priority, age, tags | 📋 | Taskwarrior's proven formula; simpler start than the token-value formula in §5 |
| Each card is an unsolved ticket with a structured result (type, summary, walkthrough) | 📋 | pr-agent (MIT) |
| ~~Run two variants of a card and pick the better one~~ | ❌ | Crystal. Dropped 2026-11-15: doubles tokens and review time for one accepted result |

## 4. Blueprint (before every run)

| Feature | Status | Notes |
|---|---|---|
| Drafted by a cheap model (haiku) with Goal / Scope / Out of scope / Shape / How it's checked | ✅ | About 10 s; configurable model |
| Says committing to the card's own branch is allowed | ✅ | |
| **Cost range** from similar past runs, narrowing as history grows and as steps finish ("hourglass") | ◐ | From history ✅ (2026-11-17): each run records the 5h and weekly quota it used (after − before, an upper bound if you were busy too) in `runs.jsonl`; a card shows min–max from similar runs, P10–P90 from 5+, in `show`, `eat-tokens` and the app JSON. Narrowing as steps finish 📋. Models predict their own spend poorly (r ≤ 0.39), so ranges come from history |
| Edit the blueprint before approving | ✅ | The strongest taste signal: each edit is logged as a taste signal |
| Blueprint model reads the repo (read-only) and flags "Can't run unattended: …" | ✅ | Boundary test: it caught the network-only card before it ran |
| Drafting waits until a 5-hour window is active | ✅ | Drafting is a model call and would otherwise start a window |
| Only write `QUESTIONS.md` when something is genuinely unclear | ◐ | Prompt asks for it; noticed once that it was added by default |
| **File boundary**: the blueprint lists the files and folders it may change; the sandbox only allows writes there | 📋 | cc-sdd |
| **Project principles** ("constitution") fed into every blueprint, from the project section of taste.md | 📋 | spec-kit (MIT) |
| Blueprint as a small change proposal; finished ones archived as history for cost ranges | 📋 | OpenSpec (MIT, TypeScript) |
| **Diagram-first blueprints and reports** (flowchart or mind map) for people who understand scope through a picture | ◐ blueprints ✅ (2026-11-17), reports 📋 | 2026-11-23 (PR #13): the drawing agent gets the top 3 diagram types suggested from the blueprint's wording, and the app shows which type was drawn and why. Every card opens with a picture drawn by an agent following the vendored diagram-design skill (`cli/vendor/diagram-design`, Chompyy skin, light + dark by token swap, self-check run), redrawn when the blueprint changes. Before that: diagram-design (MIT, 45 diagram types as self-contained HTML + SVG, works in Claude Code, Codex, Cursor) for rich diagrams; Mermaid (MIT) where plain text must render on GitHub; markmap (MIT) for mind maps. On or off is a taste preference, learned or set |

## 5. Away runs

| Feature | Status | Notes |
|---|---|---|
| `chompyy away <1h\|30m>`: approved cards one at a time, headless (`claude -p`) | ✅ | `--dry-run` shows the plan first |
| Each card in its **own git worktree** on `chompyy/<id>` (or a draft folder outside git) | ✅ | Your branches are never touched |
| **OS sandbox** (Claude Code's): shell writes only in the card's folder + its repo's `.git`; no network unless allowed | ✅ | Verified on macOS with a real run; refuses to run if the sandbox can't start |
| Safety rules in the prompt: nothing outward, stay in scope, write `QUESTIONS.md` instead of guessing | ✅ | |
| Tool limits: `acceptEdits`, allow and deny lists, permission prompts denied instead of hanging | ✅ | |
| Per-card timeout, turn cap, capped by time left in the away run | ✅ | |
| Timeout and Ctrl-C stop the agent's whole process group | ✅ | |
| A card stuck in running after an interrupted run goes to review as an error (with its branch), whenever no away is alive | ✅ | Changed 2026-11-18: going back to approved hid the crash and could crash every away. See research/incidents/2026-11-17-away-out-of-memory.md |
| **Night-shift guardrails**: one bad card never eats the night. Each card runs in its own worker process (a crash ends only that card, its orphaned agent is stopped, the queue goes on), a supervisor watchdog kills a worker that outlives its card, a card whose agent prints nothing for 15 min is stopped as ⛔ stuck (`idleTimeoutMin`), and the runner's memory is bounded | ✅ | 2026-11-18, after the 2026-11-17 out-of-memory crash |
| **Away readiness, step 1: `chompyy preflight`**: finds every check in a repo (tests, typecheck, swift build, in subfolders too), runs them on clean latest main in the away box *and* outside it, and calls each one ready, blocked by the box (with the cause from a failure catalog), or broken on main. Agents get the commands proven to pass in the box | ✅ | 2026-11-18. Design: research/away-readiness.md (steps 2–6 next) |
| **Away readiness, step 2: fresh base + setup**: cards start from the latest main (fetched), Keep lands them on that branch (in the folder that has it open, or a temporary copy), and dependencies are cloned from your checkout or a snapshot installed once per lockfile, never per card | ✅ | 2026-11-18 |
| **Away readiness, step 3: permission plan + research in drafting**: the approval stage asks what a 3 AM run can't: each card lists what its run may need beyond the box (from earlier runs' blocks, preflight, and the blueprint's Needs), unticked by default; you tick, it runs with exactly that. Drafting can search the web | ✅ | 2026-11-18 |
| **Away readiness, step 4: verify main vs card**: Chompyy runs the repo's checks on the card and on the main it started from, compares failing tests by name, and reports only what the card broke; the app leads with this measurement and shows the agent's claim underneath | ✅ | 2026-11-18 |
| **The agent's checks agree with Chompyy's**: the agent's sandbox and Chompyy's own check box allow the same temp folders (one list), so a check that passes for one passes for the other; a check blocked by the sandbox is "not run", never "failed" | ✅ | 2026-11-19 (PR #32): five cards said "checks failed" while Chompyy's own check said nothing broke (`swift build` needed the macOS temp folder). Also fixed `npm test` failing on main with a test-runner timeout |
| **Refresh: Chompyy handles clashes, not you**: after each Keep, every card in review that now clashes with main is brought up to date in the background (git merges it, or a short sandboxed agent fits both changes together), then Chompyy's own check runs again on the new main. Keep on a clashing card ("Update & keep") does the same and keeps it once the check passes. Chompyy checks the agent's merge itself (no conflict markers, merge finished, contains main) and undoes it otherwise. Waits instead of paid extra usage | ✅ | 2026-11-19 (PR #34), after #20 and #21 clashed with cards kept before them |
| **Away readiness, step 5: self-test (lab only)**: a fake night that runs the whole pipeline (fresh base, setup, sandbox, run, verify, keep, refresh, live update) against a test repo, so a new bug fails a test instead of a night. A developer tool for Chompyy's own repo, not a user feature | ✅ | 2026-11-20: `npm run lab` (PR #38) |
| **Away readiness, step 6: app status**: the app shows each stage of a running card (setup, running, checking) | 📋 | research/away-readiness.md |
| **Never lose a result**: commit what the agent left uncommitted after each run; keep refuses if work would be lost | ✅ | Found 2026-11-16 ([boundary test](research/boundary-test-2026-11-16.md)) |
| **Runs report their own checks** (`CHECKS: passed / failed / not run`), shown as Checks pass / Checks fail / Not checked | ✅ | "ok" used to mean only "exited cleanly" |
| Sandboxed local commands auto-allowed (tests, scripts); outward commands still denied | ✅ | |
| Quota re-read before each card in an away run | ✅ | |
| Warn at approval when two cards touch the same files | ✅ | 2026-11-17: compares the files a blueprint names with queued cards' blueprints and unreviewed runs' real changes; a warning, not a block. Run again recovers |
| Independent check (run the repo's tests outside the agent) | ✅ | 2026-11-17: after each worktree run Chompyy detects the test command (npm/pnpm/yarn, go, cargo, pytest, make; `checkCommands` overrides) and runs it in a macOS `sandbox-exec` box (writes in the card's folder only, no network, no credential reads), borrowing your `node_modules`. Its verdict outranks the agent's; failures that look sandbox-caused say so. Skipped off macOS |
| **Triggers**: last hour before a reset, bedtime (set once), `/away` | ✅ | `/away` ✅; last-hour and bedtime ✅ (2026-11-17): `chompyy triggers on` installs a LaunchAgent running `chompyy tick` every 5 min; once per window / per night; the gate still decides each card; `away.lock` keeps it to one run at a time |
| Token-value priority to order cards: `(impact × P(success) × urgency) ÷ (tokens × price now)`, where price depends on whether you're present, budget scarcity and an imminent reset | 💭 | From the design conversation; start simple |
| **Circuit breaker**: stop a card that loops (same tool call or failing command repeated) and a two-condition "done" check | ◐ | Loop stop ✅ (2026-11-17): away runs stream (`stream-json`) and stop on the same tool call 5× in the last 20, or the same command failing 4× in a row → status ⛔ stuck. The two-condition done check is the independent check above. | ralph-claude-code; codeburn `guard` has the loop detection to copy |
| **Contact the human as a step**: the card pauses on `QUESTIONS.md` and resumes after you answer | 📋 | 12-factor-agents (licence unclear: ideas only) |
| **Auto-detect away** from screen lock, sleep or idle, instead of waiting for `/away` | 📋 | Hammerspoon; asks once before the first auto run |
| **Run with the laptop closed**: on your own GitHub Actions or a cloud sandbox | 📋 | claude-code-action, E2B; check provider terms first |
| **Container isolation** option: each card in a container plus git branch, any agent | 📋 | container-use (Apache-2.0); needs Docker, so opt-in. Also solves credential reads |
| Block reads of credential folders (`~/.ssh`, `~/.aws`) in the sandbox | ✅ | 2026-11-17: `denyReadPaths` (~/.ssh, ~/.aws, ~/.gnupg, gh/gcloud/azure/kube/docker config, .netrc, .npmrc, Keychains, …) go to the sandbox's `denyRead` for shell commands and to `Read(...)` deny rules for the file tools |
| **Away runs can't write the repo's `.git`**: a hook or a `core.fsmonitor` line planted there would run outside the sandbox at Keep. Chompyy commits for the agent and resets the worktree's `.git` link before any git command | ✅ | 2026-11-23 (#53), from a tester's code review (#24) |
| **No web tools in away runs, and file reads only in the card's folder**: WebFetch bypasses the sandbox's network block; `"awayWeb": true` turns web search back on | ✅ | 2026-11-23 (#53) |
| **`chompyy app` checks the download**: SHA-256 published next to the release zip, `codesign --verify --deep --strict` before anything is replaced or opened | ✅ | 2026-11-23 (#54). Quarantine and `spctl` come with notarization (#21) |
| **Keychain read is opt-in**: live quota asks first (Allow in the app, `chompyy quota --allow-keychain`); earlier Always Allow counts as a yes | ✅ | 2026-11-23 (#55) |
| Board lock so two away runs can't pick the same card | ✅ | `away.lock` (with the triggers, 2026-11-17): one away run at a time; a lock left by a dead process doesn't count |
| Runners for other agents (`codex exec`, `cursor-agent`, …) | 📋 | |
| **Hand off through a card**: turn a stopped session into a card (goal, what's done, what's left, branch, open questions) that any agent can pick up, e.g. Claude → Codex | ❌ | Not a focus (2026-11-15): agent-to-agent handoff is a different product |

## 6. Report, review and rating

| Feature | Status | Notes |
|---|---|---|
| **Action-first report**: one thing to do per card, cards that need you first, whole questions (wrapped, never cut) | ✅ | Redesigned after a 2/5 rating ("hard to read") |
| Details on request: `show` (incl. what the agent said), `diff` | ✅ | |
| `keep`: merge the card's branch (refuses on uncommitted changes, aborts cleanly on conflicts) | ✅ | |
| `undo`: remove the card's branch and worktree | ✅ | The rollback |
| **Run again** (`redo`): throw the attempt away and re-run from your latest code, answers kept | ✅ | The way out of a keep conflict |
| **Answer** a card's questions; it continues on the next away run | ✅ | Verified with a real run |
| One commit per step with a clear message; undo a single step, not only the whole card | 📋 | aider (Apache-2.0). Since 2026-11-23 (#53) the agent can't write `.git`, so Chompyy makes one commit per card; per-step commits would need Chompyy to commit between steps |
| Keep/undo recorded, so the report stops asking | ✅ | |
| **Exact tokens per run**: input, output, cache reads and writes, and API-value cost for every card, from the run's own log (not "% before vs after", which is coarse, mixes in your own use and goes blank when the window resets mid-run). Shown on the card and in the report | ✅ | 2026-11-19. Per-interaction tagging like Langfuse; the base for honest cost estimates later. No hard per-card ceiling for now: keep the options open for evaluation. Built 2026-11-20 (PR #37) |
| **Cost estimate with its own hit rate**: a range from similar past cards ("3–6%, from 4 similar cards"), then estimate vs actual after each run and "8 of the last 10 landed in the range" | 📋 | After a few nights of exact token data |
| `rate <id> <1-5> ["why"]` → `signals.jsonl` | ✅ | Raw material for taste |
| "While you were away" **trends**: e.g. "paper digests −31% tokens, −1.2 corrections vs last month", from real runs and paired replays | ◐ | From real runs ✅ (2026-11-17): last 7 days vs the 7 before (cost per card, keep rate, rating, blueprint edits) in the report and `chompyy trends`; only with 3+ points on both sides. Per task type and paired replays 📋 |
| Morning-report framing: "Last night: 2 skills updated, 1 retired" | ✅ | "Since last time: 3 cards ran, 1 kept, using 12% of 5h windows · taste: 1 learned, 1 retired" (skills come with skill distillation) |

## 7. Taste and memory (the core)

Chompyy's main difference (see [the top](#what-makes-chompyy-different-taste-learned-from-outcomes)).

**When a preference gets written.** Every candidate needs evidence Chompyy can show you. Strongest first:

| Signal | Example | Becomes a preference |
|---|---|---|
| You undo or rewrite a result | Undid 3 cards that added unrequested tests | After 2–3 times across separate cards, asked as a one-tap question |
| You edit the blueprint before approving | Cut "add README section" from scope twice | Same |
| You edit the code after keeping it | Renamed `getData` to `fetchUser` style each time | Same |
| You correct the agent in chat | "No, use pnpm" | After it repeats in separate sessions |
| You state it with a reason | "I prefer a diagram first, I understand scope through pictures" | Right away, shown for you to confirm |
| Ratings and their "why" | 2/5 "the report is hard to read" | Right away as a candidate; confirmed by later behaviour |
| **"What would have made it a 5?"** picks (below 5★), from options written for that card | "Put the answer key in a separate file" | Strongest rating signal: a concrete change, not a feeling. Added 2026-11-16 at the user's suggestion |

**Warm, not noisy.** Proactive means work is ready when you come back, not pings while you work.

1. **Never interrupt.** Chompyy speaks only at natural moments: the report when you're back, a long wait during a run, or when you ask.
2. **One question per report, at most.** The rest wait; the strongest evidence goes first.
3. **Ask only when it matters**: enough evidence (2–3 separate cards) *and* it would change future work.
4. **Act quietly on what you confirmed, and mention it once**: "Skipped extra tests, as you prefer."
5. **Every question has "not now" and "don't ask about this".** Dismissals are signals too; Chompyy asks less after them.
6. **Show what it did for you**, briefly and specifically: "2 cards kept, from capacity that would have reset."
7. **Quiet hours** follow your bedtime and calendar.

**What Chompyy learns from (2026-11-19).** Cards you approved, ran or rated (ratings, to-a-5 picks, blueprint edits, keep/undo, answers); **your everyday sessions with agents**: corrections in chat ("no, don't…"), edits you undo, files you rewrite right after the agent touched them; and **code you write yourself** (from git: the agent wrote X, you changed it to Y). How you work is fair game: how you like explanations, pictures first, short replies late at night.

**What "Chompyy knows you" covers (2026-11-21).** The core layer leans into *how you work with your AI*, not facts about a project (those live in the code, CLAUDE.md and the agent's own memory, and they go stale). The nightly read looks for nine things, each with a real example from the first reads:

| | What it learns | Example found in real sessions |
|---|---|---|
| 1 | **How replies should be shaped**: structure, length, plain words | "Lead with what you need to do; keep details behind commands" |
| 2 | **How you learn and understand**: pictures first, examples, analogies | "Explain shorthand with a concrete example the first time" |
| 3 | **How you decide**: a recommendation or options; what you keep for yourself (money, privacy, scope) | "Give a clear recommendation with reasoning" · "Ask before spending money" |
| 4 | **How much to ask, and when to just act** | "After a short yes, carry out the whole step without more check-ins" |
| 5 | **What earns your trust**: proof, measurements, receipts, owning mistakes | "Verify claims by measuring; say plainly whether it's really fixed" |
| 6 | **How work should be done**: process, research first, your conventions | "Research prior art first" · "Don't commit docs until you've read them" |
| 7 | **Your design and product taste**: look and feel, tone, naming | "Offer several visual options when you're unsure" |
| 8 | **What annoys you**: things you ask to stop, or raise twice | "Never cut text off mid-sentence" · "No patches: build the system" |
| 9 | **How you talk**: language, length, how you reply | "You quote lines back and answer each one: reply in numbered points" |

**Praise counts as much as correction**: "LGTM", "awesome", "this gives me confidence" tell Chompyy what to keep doing. **Behaviour, never character**: a rule says what to do ("give a recommendation first"), never what kind of person you are ("indecisive"), and Chompyy never learns your opinions in order to agree with them (memory profiles raised agreement sycophancy up to 45% in one study; research/taste-learning-prior-art.md). **Chompyy's own voice follows the same rules**: its reports, notifications and questions use your active rules too, so it talks to you the way you like.

**Not written:** one-off details of a single task, anything true only for one card, secrets (passwords, keys, tokens: never stored), and anything the repo already says. **Personal facts are stated, never inferred** (following Claude's privacy approach): if you tell Chompyy "I'm dyslexic, keep text short" or "I'm in Taipei", it can remember that in its own section of taste.md that you see and edit; it never guesses things like health, relationships, money or identity from your chats. The test for each candidate: *would this change what Chompyy does in a different task next week, and can it name the evidence?*

| Feature | Status | Notes |
|---|---|---|
| **Learn from everyday sessions** (2026-11-19): corrections in chat, undone edits, files you rewrite right after the agent; and your own code via git. Code strips tool output first (free, on your Mac); a model then reads the remaining chat text in full (Opus, per the model test in research/nightly-read/). With a "what I read today" log | ✅ 2026-11-21 | **Measured on 10 days of real history (2026-11-20):** raw session logs average 3.5M tokens/day (up to 12.7M), almost all tool output; chat text alone averages 16k tokens/day (up to 32k). A word-pattern filter ("no", "don't", "stop"…) found under 1 moment a day, because people correct in their own words ("i think it should…"), so the model reads all chat text instead: ~16k tokens a night, and nothing is missed. Script: research/measure-nightly-read.py. **Re-measured 2026-11-20 with a one-line note per tool call kept** (`[Edit: cli/src/away.ts]`) and ⚑ marks for rejected tool uses and interruptions, coding folders only: 11-14 762k → 14k · 11-15 2.2M → 9k · 11-16 897k → 8k · 11-17 7.9M → 41k · 11-18 9.9M → 42k · 11-19 553k → 10k. **About 21k tokens a night on average (8–43k)**, 97–99% smaller than the raw log. ⚠️ Those sizes were estimated as characters ÷ 4; exact counts from the model runs come out ~1.6–1.8× higher on this chat text (the 6 days: 124k estimated, 221k exact), so **about 35k real tokens a night (13–75k)**. Sample of what a keyword filter misses: "i want to build a robust system to fix those issue, rn it feels like we are just patching things up" → rule: build systems, not patches |
| **Choose which workspaces Chompyy learns from** (2026-11-20): a list of every folder and app Chompyy found sessions in (coding repos, the Claude desktop app, …), each with a tick box. Coding folders (terminal sessions in a git repo) start ticked; desktop-app chats and folders that aren't repos start unticked | ✅ 2026-11-21 | Desktop-app chats can be messy and mix in daily life (homework, a blog post), and people may not want all of it in Chompyy. Chompyy can read them (found 2026-11-20); you decide. Only ticked workspaces are read |
| **Nightly read and clean-up**: every night, read only what's new since last night (chats + git), extract evidence, update proposed rules, retire contradicted ones | ◐ | ✅ 2026-11-21: `chompyy dream` reads new chat turns after each away night (or at bedtime), Opus, quotes checked word for word, chat signals into the distiller, asked after 2 different sessions; `--dry-run` and `~/.chompyy/dream/read-<date>.txt` show exactly what it read. Not yet: git (your own edits after the agent's), and the structural signals beyond ⚑ (re-asks, reverts). First real run on 4 sessions: 37 quotes, all exact → 7 new rules, 6 ready to ask, 199k tokens in / 10k out |
| **Badge + popup on "What Chompyy heard from you"**: the toolbar button shows how many rules are waiting; the popup shows each with what Chompyy noticed, the rule, its receipts, and Yes / Not now / Never | ✅ | 2026-11-20. Not a board card. Turned on the two rules that had waited since 2026-11-18. detect advice and suggested cards join it later |
| **"What Chompyy learned" panel**: active rules with their receipts and Retire, in the same popup | ◐ | Taste ✅ 2026-11-20; detect findings with measured/estimated labels join it (one evidence engine) |
| **Receipts on every rule**: each rule opens to the exact ratings, picks, edits and answers behind it, in your own words | ◐ | Card signals ✅ 2026-11-20; chat lines once everyday sessions are read |
| **Taste in daytime sessions**: your active rules go into a file Claude Code always loads, so a rule you said yes to this morning shapes this afternoon's session, not only away cards | 📋 | What makes taste feel real |
| **Stated facts section** in taste.md: things you told Chompyy about yourself, visible and editable, never inferred | 📋 | |
| **Taste travels between tools and models**: one central taste.md handed to Claude Code, Codex (AGENTS.md), Cursor and agent workspaces (Orca, herdr, hermes, opcode, …); Chompyy "smells" taste from several providers' sessions and shares one file | 📋 | No vendor can do this: each sees only its own tool |
| **Learning shown as a number**: "Chompyy learned 4 rules this week; your corrections per session dropped from 6 to 3" | 📋 | Chompyy's impact as a feature; the keep-rate data behind it is already recorded with dates |
| Personal assistant beyond work (a separate opt-in store, never sent to coding agents) | 💭 | Only if Chompyy grows past coding work |
| `taste.md` stub and `/taste` | ✅ | Plain text, user edits win |
| **Evidence behind every preference**: "why do you think that?" shows the cards, edits and quotes | ✅ | `chompyy taste why <id>`; citations checked against `signals.jsonl`. What makes it feel cared for rather than creepy |
| **Ask, don't assume**: new preferences arrive as one-tap questions in the report | ✅ | One per report, strongest evidence first; `taste yes / not-now / never`; in the app JSON as `tasteQuestion` (app UI 📋). |
| **Rating asks "What would have made it a 5?"** with 3–4 card-specific options (cheap model, cached) + "Something else"; 5★ asks "What made it great?" | ✅ | Saved as `toFive` in signals.jsonl; generic options when no window is active |
| **Feedback view**: everything recorded from you (ratings, to-a-5 picks, edits, answers) | ✅ | Toolbar 💬; `chompyy signals` |
| **Warm, not noisy** (rules below) | ◐ | 2, 3 and 5 ✅ (one question per report, asked only with evidence, "not now" waits for a new card, "never" stops it); quiet hours and "mention it once" 📋 |
| **Preferences with validity periods**: valid-from date; retired with the contradicting evidence, never silently deleted | ✅ | `preferences.json` (status, evidence, validFrom, retiredBecause, against) renders the learned lines in `taste.md`; deleting a learned line retires it. graphiti's model (Apache-2.0) in a plain local file. Not graphiti itself: it needs a graph database, against "no extra installs" |
| Background consolidation while you're away (sleep-time agent) | ✅ | Distils after every away run and at bedtime when there are new signals, inside an active window only |
| `<private>` tags and progressive disclosure (index → timeline → details) | 📋 | claude-mem; for the cold start and taste loading |
| ✅ **History cold start** (Claude Code): privacy notice first, read transcripts locally, propose a first taste.md and suggested cards for you to approve | ✅ | `chompyy history`, `chompyy coldstart`, app banner + sheet. One model call (sonnet) over a ≤60k-char digest; taste needs 3+ sessions; citations verified; `keep-history` raises `cleanupPeriodDays` (on the first real run, 4 transcripts aged out the same day) |
| Privacy notice: what it reads, runs locally, keeps only taste.md and the board, filters secrets, approve before use, one command forgets everything | ✅ | "See exactly what's sent" shows the digest; pasted blocks become [pasted text], also without paste markers (code, logs, traces, diffs; 0 found in 550 real prompts); more secret types and phone numbers removed; `chompyy coldstart forget` |
| **Taste distiller** (nightly): signals → candidate preferences; written only after 3 separate confirmations; removed when contradicted | ✅ | `chompyy distill` (sonnet, one call over new signals). Asked after 3 separate cards, or 1 when you said it in a rating; written only on yes; keep/undo now logged as signals. Signals, strongest first: blueprint edits, edits to results, chat corrections, ratings, accepted or rejected suggestions |
| **Memory in layers, loaded by relevance** (2026-11-20): **About you** (stated facts, how you like explanations; always loaded, kept small) · **By area** (coding, writing, research, planning, everyday tasks; loaded only when the task is in that area) · **By project** (one repo or folder; only there). Personal things beyond work in their own store, never sent to coding agents | 📋 | As Chompyy helps with more than code, loading everything would explode the context. Policies: a size budget (e.g. ≤ 1.5k tokens of taste per call); a one-line index first, details only when relevant (progressive disclosure, claude-mem); a stable order so taste never breaks the prompt cache (rulebook C3); stale rules come up for review |
| Learn only from approved or rated work | ✅ | Signals of cards never approved, run or rated are ignored. Ungoverned memory hurts (research card G5) |
| **Event memory off by default per conversation**, opt-in | 📋 | Taste stays on; over-recall in unrelated chats is what users find intrusive |
| Skill distillation from approved runs: strong model distils, cheap model runs; skills expire and get re-checked | 📋 | Research cards G1, G4, G5 |
| History import for Cursor (and other tools via codeburn's readers) | 📋 | |

## 8. Optimization (second priority)

From the [research cards](research/atomic-knowledge.md); combined as a measured policy per task type, never as a stack of compressors.

| Feature | Status | Source |
|---|---|---|
| **The detective, step 1: rulebook**: what wastes tokens, distilled from the code of rtk, headroom, ponytail, caveman, token-optimizer and codeburn; each rule with evidence, the local data it reads and a fix lane | ✅ | [research/detective/RULEBOOK.md](research/detective/RULEBOOK.md) (PR #35) |
| **`chompyy detect`** (step 2): runs the rulebook on your local files (transcripts, settings, CLAUDE.md, skills, MCP) and lists findings, each with evidence, a **measured / estimated** label (codeburn) and an evidence count (headroom: 2+ occurrences, no one-offs) | ◐ | 2026-11-23: first version in the CLI with rules S2–S5 (startup tax) and C1–C2 (cache); the other chapters, the app panel and the morning badge are next. Findings go to the "What Chompyy learned" panel and the morning badge (§7). 2026-11-25: one-screen summary ranked by tokens (`--all` for the evidence), works cold through `npx chompyy detect`, and C2 names the cause of a rebuild (Tool Search loading an MCP server's tools, or /mcp, /model) |
| **Live, evidence-based suggestions** while you work: better than the generic /clear and /compact tips because they're timed and priced from your own history ("you've been away 50 min, the cache expires in 10; /compact now keeps the return near 10k instead of your usual 100k") | 📋 | Asked 2026-11-25. Likely through the status line and hooks Chompyy already installs; same rules as detect, fired at the moment they pay off |
| **Bird's-eye view across agents**: the agents you approve (Claude Code, Codex, Cursor and others) read side by side, so the advice optimizes the whole setup, not one vendor's slice | 📋 | Asked 2026-11-25. Providers only see their own tool; this is where Chompyy can be different |
| **Impact you can see**: each fix shows before → after → re-measured, and a running total of tokens saved and unused hours put to work, in plain words | 📋 | Asked 2026-11-25. Builds on step 5 (did it work?) |
| Advice cards (step 3) and away-run fix lanes (step 4): approved advice is applied while you're away (settings: a backed-up diff; work: a sandboxed card) | 📋 | |
| **Did it work?** (step 5): re-measure ≥ 3 days after a fix; "worked" at ≥ 70% of the promise, rounded down (codeburn's act report); declined advice becomes taste | 📋 | |
| Runs ignore other tools' hooks and MCP servers (rule T3) | ✅ | PR #35 |
| Session setup decided once and frozen: task type → tools (few, complete), skill, model, effort, turn cap | 📋 | A2, A3, D4, E1, E4 |
| Append only; compress tool output before it enters history (borrow rtk) | 📋 | A1, C1, C2 |
| Sub-tasks fold into subagents with a shared prefix | 📋 | F1, F4 |
| Keep the cache warm between turns (< 5 min) or a cheap keep-alive | 📋 | A5 |
| State written to files; long session → fresh session from files, not compaction | 📋 | C5, D2, A10 |
| Fail → rerun at higher effort, not a bigger model mid-session | 📋 | A12, A3 |
| Startup cost audit and waste fixes | ◐ | Detective rulebook ✅ (chapters 1–10: startup tax, cache, output, reading, loops, context, verbosity, clashes between optimizers, terms, measuring); `chompyy detect` 📋 |
| Repo map: a compact outline of the codebase instead of reading whole files | 📋 | aider (Apache-2.0) |

## 9. Interfaces

| Feature | Status | Notes |
|---|---|---|
| CLI (`chompyy`) in TypeScript | ✅ | Stay with TypeScript; rewrite one hot part in Rust only if measured slow |
| Agent shortcuts: `/later`, `/eat-tokens`, `/away`, `/taste` | ✅ | |
| Status line: `🍪 5h 93% left · 2h41m · ~35%/h \| 7d 11% used` | ✅ | When another tool (e.g. Orca) owns the status line, combine with a wrapper |
| Menu bar app (Swift, thin UI over the CLI) | ◐ | `mac/`: cookie icon, popover with what's left, the week pace and cards waiting for you 2026-11-21: the popover adds today's tokens and API value with Trend / Calendar; the ⋯ menu picks what sits beside the cookie (% left, today's tokens, today's API value). |
| **Card board window** (Swift): kanban of cards; open one to read its blueprint, approve, edit, answer its questions, see the result, keep or undo. All without a terminal | ◐ | Wanted 2026-11-15: reading and answering cards in the CLI isn't pleasant. The CLI stays for scripts and agents |
| **Picture first**: blueprint shown as a diagram before the text, with "Redraw" | ◐ | Native 4-box map built; diagram-design (MIT) for richer diagrams next |
| **Cookie icon eaten bite by bite**: one bite per ~1/8 of the window used, so what's left on the plate is what Chompyy can still eat | ✅ | Idea from claude-codex-battery (MIT, Swift). Bites are scalloped tooth marks around the edge, not clean pie wedges, which would look like Pac-Man |
| **Chompyy's eyes** (2026-11-18): capsule eyes and 12 expressions from open-mascot-studio (MIT), picked at random; one lively tempo at every quota level (a new expression every ~1 s, springy; the near-limit slowdown was removed 2026-11-19); googly pupils follow your mouse (pupil physics after Morkrom/googlyeyes, MIT). Cookie eaten from one side with a scalloped bite edge, 20 chips | ✅ | `mac/Sources/Chompyy/Mascot.swift`; preview: `CHOMPYY_RENDER_COOKIES=<png> Chompyy` |
| **Percent left beside the menu bar cookie** ("73%"), like a battery | ✅ | 2026-11-19, card #12: the face is hard to read at menu bar size |
| **Opens like any Mac app, and at login**: installed in `~/Applications`, opened from Spotlight or Launchpad it shows the board; open at login on by default (⋯ menu turns it off) | ✅ | 2026-11-23 (PR #52) |
| **Live copy: kept cards reach the app by themselves**: the app runs from `~/.chompyy/live`, which follows main; after each Keep on main the CLI rebuilds (seconds) and the app rebuilds and restarts if its code changed (1–2 min). A failed build keeps the last good one. No work folder can take the app over | ✅ | 2026-11-19 (PR #33), for Chompyy's own development (`chompyy live set`); testers' installs unchanged |
| **WidgetKit widgets** (desktop, Notification Center): the cookie and what's left | 📋 | CodexBar has them (Swift); wanted 2026-11-15 |
| Capacity Dock: thin rail at a screen edge, one ring per provider | 💭 | codeburn |
| **"Where it works"** in every card: your folder (untouched until Keep) vs its copy and branch, with Show in Finder | ✅ | 2026-11-16, so it's visibly safe to run on a real repo |
| Away runs keep the Mac awake (`caffeinate -i`); "Going to sleep (8h)" option | ✅ | Stops anyway when the 5-hour window resets, so it never starts a new one |
| Sandboxed builds and tests work for Go, npm, pip (caches moved to `~/.chompyy/cache/tools`) | ✅ | Verified `go vet` inside the sandbox |
| **Visual language from affectUI** (soft tones, pills, springy motion, rolling numbers, shimmer) for the production polish | 📋 | affectUI is React (74 MIT items, rest paid): we borrow its look in SwiftUI, not its code |
| Google Calendar (free/busy only) to propose away windows | 📋 | v2 |
| Windows and Linux | 📋 | Later, after the Mac MVP; Tauri (Apache-2.0) or Electron (codeburn's choice) |

## 10. Hardening and verification still to do

- A real card timing out mid-task; how much quota a typical card uses.
- The sandbox on Linux and WSL2 (needs `bubblewrap` and `socat`).
- Claude Code versions older than 2.1.322 (`--permission-prompts`).
- The allow list is fussy (a chained `echo` was refused once).
- **Measure the premise**: how often a 5-hour window resets with capacity left *and* the weekly limit isn't binding. Without that, "saved capacity" claims aren't proven. ◐ 2026-11-23: `chompyy premise` measures it for one person; across volunteers still to do.

## 11. Proof: evals and benchmarks

Numbers that make the pitch convincing to people who doubt it. Eval projects: [feature-inspiration §10](research/feature-inspiration.md).

| Measure | How | Status |
|---|---|---|
| **The premise**: share of 5-hour windows that reset with capacity left while the weekly limit isn't binding | From saved quota snapshots and transcripts, across volunteer users | ◐ `chompyy premise` (2026-11-23), one user so far: in the week to 22 Nov, 7 of 8 measured windows (88%) reset with 20%+ left while the week reset with ~23% unused. Next: ask testers for `chompyy premise --json` |
| **Learning as a number**, shown in the app: rules learned per week and corrections per session over time (§7) | Already recorded with dates (keep/undo, ratings); corrections per session once everyday sessions are read | 📋 |
| **Taste works**: keep rate and corrections per card, with taste.md vs without | Same cards run both ways, user reviews blind | 📋 the answer to "normal agents can do that" |
| Taste accuracy: share of proposed preferences you accept | From the one-tap questions | 📋 |
| Cost per accepted card, and acceptance rate | From the board and runs | 📋 |
| Harness cost on a public benchmark | Aider Polyglot, as in branchwork#107 | 📋 |

**Self-improvement experiments (switch, off by default).** When on, Chompyy uses capacity that would reset unused anyway to run small experiments: replay a past card with and without a taste rule, a skill, or a cheaper model, and compare. Results arrive as a comparison table in the report ("with the 'no extra tests' rule: kept 4/5 vs 2/5"). Never spends on-pace budget; stops with the same gates as away runs.

## Decisions on record

| Decision | Date |
|---|---|
| Utilization first (unused 5-hour capacity); optimization second | 2026-11-13 |
| First users: Claude Code subscription users | 2026-11-12 |
| Scope like codeburn: standalone, any agent, reads files on disk, suits non-CLI users | 2026-11-13 |
| TypeScript core + Swift menu bar | 2026-11-13 |
| Name **Chompyy**; mascot a chocolate cookie with a real bite out of it (not a clean wedge) | 2026-11-13 |
| Commands: `/eat-tokens`, `/later`, `/away`, `/taste` | 2026-11-13 |
| Weekly rule: stay on pace, hard stop at 90% | 2026-11-14 |
| Away runs sandboxed by default | 2026-11-14 |
| Report action-first; details on request; keep/undo | 2026-11-14 |
| Foundation: codeburn + CodexBar, own features on top; copy and port their code with credit, no extra installs | 2026-11-14 |
| Core in TypeScript (copy codeburn), Mac app in Swift (reuse CodexBar and codeburn UI) | 2026-11-14 |
| **Taste learned from outcomes is Chompyy's main difference** | 2026-11-15 |
| Don't run two variants of a card (Crystal idea dropped) | 2026-11-15 |
| Mac MVP in Swift with a nice UI first; Windows and Linux later (Tauri not now) | 2026-11-15 |
| Cards are read and answered in the Mac app, not the CLI | 2026-11-15 |
| No agent-to-agent handoff for now | 2026-11-15 |
| Quota from Anthropic's usage endpoint by default (Way 2), status line as fallback | 2026-11-15 |
| Build the Mac board UI before the cold start, to test sooner | 2026-11-15 |
| **Picture first** is a core difference, next to taste | 2026-11-15 |
| **Three sides + one core**: use the window (now), monitoring board, optimization; taste is the meta ability across all three | 2026-11-19 |
| Learn from everyday agent sessions and your own code, not only board cards; personal facts stated, never inferred; secrets never | 2026-11-19 |
| Taste questions as a badge + popup on "What Chompyy heard from you", not a board card | 2026-11-19 |
| Exact tokens per run first; no per-card hard cost ceiling for now | 2026-11-19 |
| Self-test harness stays a lab tool, not a user feature | 2026-11-19 |
| Monitoring board: research the open-source monitors first (like the rulebook), then copy what's best | 2026-11-19 |
| Chompyy handles clashes between cards itself (refresh); kept cards reach the app by themselves (live copy) | 2026-11-19 |

## Open questions



- Provider terms on automated use of subscription plans (Chompyy presents runs as approved, useful work; no warm-up pings without checking).
- Trademark search for "Chompyy" (`chompyy` is free on npm).
