# Chompyy features

Everything Chompyy does or is planned to do, in one list to build from. Collected from the [spec](research/spec-token-utilization.md), the [research](research/atomic-knowledge.md), the shipped CLI ([`cli/`](cli/README.md)), issue #2, and the design conversations. Updated 2026-11-17.

**Status:** ✅ built · 🔜 next · 📋 planned · 💭 idea (not decided)

Ideas from 100 related open-source projects, 10 per section: [research/feature-inspiration.md](research/feature-inspiration.md).

> **The goal:** more finished work per weekly allowance, with less back-and-forth. The main metric is *accepted results from capacity that would have reset unused*, with acceptance rate as the warning sign. Tokens burned on unwanted work don't count.

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
5. ✅ **Taste distiller**, triggers (last hour, bedtime), cost ranges, the "while you were away" trends (CLI, 2026-11-17; the Mac app doesn't show the taste question or cost ranges yet)
6. 📋 **Optimization side**: cache-aware sessions, compression before history
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
| **optimize**: find token waste, audit startup costs | codeburn (`optimize`, `context`) | 📋 |
| **compare** models on your own history | codeburn | 📋 |
| **guard / budgets**: spending caps | codeburn (`budget`) | 📋 |
| **Checks its own fixes** against later sessions | codeburn (`act report`) | ◐ ratings logged ✅; before/after numbers 📋 |
| Provider status and incident badges; don't start away cards during an outage | CodexBar | 📋 |
| **Where the agent gets stuck**: error breakdown and failing or abandoned tasks from history | sniffly (MIT, Python: port the idea) | 📋 also feeds cold-start suggestions |

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
| **Rolling daily allowance** shown as an "on pace / ahead / behind" bar: `today = remaining weekly ÷ days left` | 📋 | Approved design; day ends at your bedtime; unspent allowance funds the night |
| Weighting days by your own usage pattern (e.g. light weekends) | 💭 | Deferred as an advanced feature |
| **Signed pace delta** in the status line: `⇣15%` green = headroom, `⇡15%` red = burning fast | 📋 | claude-pace (MIT, one Bash file); readable at a glance |
| **Forecast unused at reset**: "~40% of this window will reset unused at 18:20", the moment to offer cards | 📋 | Claude-Code-Usage-Monitor (MIT) forecasts run-out; we flip it. CodexBar's unused-quota reset warning is the same trigger |
| Freeze the forecast once a limit is hit (no fake projections) | 📋 | Claude-Code-Usage-Monitor |
| **Never spill into paid extra usage**: close the gate at 100% even if extra credits would allow more | 📋 | cship |
| **Per-model weekly limits** (e.g. Opus 7-day vs all models) in the gate | 📋 | Usage4Claude |
| **Learn your away times** from a weekday × hour usage heatmap and propose away windows | 📋 | AgentLimits |
| **Prompt-cache countdown** (`❄ 4m23s` until the next turn pays full price) | 💭 | claude-code-usage-bar (MIT). Display only; no automatic keep-alive pings without checking provider terms |
| Limits for other agents and providers | 📋 | Via CodexBar (Foundation) |

## 3. The board and capturing ideas

| Feature | Status | Notes |
|---|---|---|
| Board columns: suggested · later · approved · running · review · done | ✅ | Only allowed moves; a card can't be approved without a blueprint |
| `chompyy later "<idea>"`: park a stray idea without switching tasks | ✅ | Blueprint drafted in the background |
| `board`, `show`, `approve`, `drop` (archived, not deleted) | ✅ | |
| `chompyy eat-tokens`: leftover window plus the cards you could run (read-only) | ✅ | |
| **Suggested cards on request only** (no automatic pushes) | 📋 | The more you ask, the more it prepares; cap and expire stale ones |
| Suggestions from history: unfinished ideas, "let's do that later", TODOs the agent left, abandoned tasks, routines repeated 3+ times | ✅ | Cold start; each card must quote what you said, checked against the digest |
| Suggestions related to what you're working on now | 📋 | |
| Review cards while waiting: during a long run, show 1–2 cards to approve instead of scrolling | 📋 | Only during waits over ~1 minute, never while typing |
| Stale-card expiry | 📋 | |
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
| Edit the blueprint before approving | 📋 | The strongest taste signal |
| Blueprint model reads the repo (read-only) and flags "Can't run unattended: …" | ✅ | Boundary test: it caught the network-only card before it ran |
| Drafting waits until a 5-hour window is active | ✅ | Drafting is a model call and would otherwise start a window |
| Only write `QUESTIONS.md` when something is genuinely unclear | ◐ | Prompt asks for it; noticed once that it was added by default |
| **File boundary**: the blueprint lists the files and folders it may change; the sandbox only allows writes there | 📋 | cc-sdd |
| **Project principles** ("constitution") fed into every blueprint, from the project section of taste.md | 📋 | spec-kit (MIT) |
| Blueprint as a small change proposal; finished ones archived as history for cost ranges | 📋 | OpenSpec (MIT, TypeScript) |
| **Diagram-first blueprints and reports** (flowchart or mind map) for people who understand scope through a picture | ◐ blueprints ✅ (2026-11-17), reports 📋 | Every card opens with a picture drawn by an agent following the vendored diagram-design skill (`cli/vendor/diagram-design`, Chompyy skin, light + dark by token swap, self-check run), redrawn when the blueprint changes. Before that: diagram-design (MIT, 45 diagram types as self-contained HTML + SVG, works in Claude Code, Codex, Cursor) for rich diagrams; Mermaid (MIT) where plain text must render on GitHub; markmap (MIT) for mind maps. On or off is a taste preference, learned or set |

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
| A card stuck in running after an interrupted run goes back to approved | ✅ | |
| **Never lose a result**: commit what the agent left uncommitted after each run; keep refuses if work would be lost | ✅ | Found 2026-11-16 ([boundary test](research/boundary-test-2026-11-16.md)) |
| **Runs report their own checks** (`CHECKS: passed / failed / not run`), shown as Checks pass / Checks fail / Not checked | ✅ | "ok" used to mean only "exited cleanly" |
| Sandboxed local commands auto-allowed (tests, scripts); outward commands still denied | ✅ | |
| Quota re-read before each card in an away run | ✅ | |
| Warn at approval when two cards touch the same files | 📋 | Overlaps conflict at keep time today; Run again recovers |
| Independent check (run the repo's tests outside the agent) | 📋 | Today the agent grades itself |
| **Triggers**: last hour before a reset, bedtime (set once), `/away` | ✅ | `/away` ✅; last-hour and bedtime ✅ (2026-11-17): `chompyy triggers on` installs a LaunchAgent running `chompyy tick` every 5 min; once per window / per night; the gate still decides each card; `away.lock` keeps it to one run at a time |
| Token-value priority to order cards: `(impact × P(success) × urgency) ÷ (tokens × price now)`, where price depends on whether you're present, budget scarcity and an imminent reset | 💭 | From the design conversation; start simple |
| **Circuit breaker**: stop a card that loops (same tool call or failing command repeated) and a two-condition "done" check | 📋 | ralph-claude-code; codeburn `guard` has the loop detection to copy |
| **Contact the human as a step**: the card pauses on `QUESTIONS.md` and resumes after you answer | 📋 | 12-factor-agents (licence unclear: ideas only) |
| **Auto-detect away** from screen lock, sleep or idle, instead of waiting for `/away` | 📋 | Hammerspoon; asks once before the first auto run |
| **Run with the laptop closed**: on your own GitHub Actions or a cloud sandbox | 📋 | claude-code-action, E2B; check provider terms first |
| **Container isolation** option: each card in a container plus git branch, any agent | 📋 | container-use (Apache-2.0); needs Docker, so opt-in. Also solves credential reads |
| Block reads of credential folders (`~/.ssh`, `~/.aws`) in the sandbox | 📋 | Known limit |
| Board lock so two away runs can't pick the same card | 📋 | Known limit |
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
| One commit per step with a clear message; undo a single step, not only the whole card | 📋 | aider (Apache-2.0) |
| Keep/undo recorded, so the report stops asking | ✅ | |
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

**Not written:** one-off details of a single task, moods, anything true only for one card, secrets, and anything the repo already says. The test for each candidate: *would this change what Chompyy does in a different task next week, and can it name the evidence?*

| Feature | Status | Notes |
|---|---|---|
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
| Scoped taste: everywhere / per task type / per project; only relevant sections load at session start | 📋 | Keeps the startup small and cache-stable |
| Learn only from approved or rated work | ✅ | Signals of cards never approved, run or rated are ignored. Ungoverned memory hurts (research card G5) |
| **Event memory off by default per conversation**, opt-in | 📋 | Taste stays on; over-recall in unrelated chats is what users find intrusive |
| Skill distillation from approved runs: strong model distils, cheap model runs; skills expire and get re-checked | 📋 | Research cards G1, G4, G5 |
| History import for Cursor (and other tools via codeburn's readers) | 📋 | |

## 8. Optimization (second priority)

From the [research cards](research/atomic-knowledge.md); combined as a measured policy per task type, never as a stack of compressors.

| Feature | Status | Source |
|---|---|---|
| Session setup decided once and frozen: task type → tools (few, complete), skill, model, effort, turn cap | 📋 | A2, A3, D4, E1, E4 |
| Append only; compress tool output before it enters history (borrow rtk) | 📋 | A1, C1, C2 |
| Sub-tasks fold into subagents with a shared prefix | 📋 | F1, F4 |
| Keep the cache warm between turns (< 5 min) or a cheap keep-alive | 📋 | A5 |
| State written to files; long session → fresh session from files, not compaction | 📋 | C5, D2, A10 |
| Fail → rerun at higher effort, not a bigger model mid-session | 📋 | A12, A3 |
| Startup cost audit and waste fixes | 📋 | via codeburn `optimize` |
| Repo map: a compact outline of the codebase instead of reading whole files | 📋 | aider (Apache-2.0) |

## 9. Interfaces

| Feature | Status | Notes |
|---|---|---|
| CLI (`chompyy`) in TypeScript | ✅ | Stay with TypeScript; rewrite one hot part in Rust only if measured slow |
| Agent shortcuts: `/later`, `/eat-tokens`, `/away`, `/taste` | ✅ | |
| Status line: `🍪 5h 93% left · 2h41m · ~35%/h \| 7d 11% used` | ✅ | When another tool (e.g. Orca) owns the status line, combine with a wrapper |
| Menu bar app (Swift, thin UI over the CLI) | ◐ | `mac/`: cookie icon, popover with what's left, the week pace and cards waiting for you |
| **Card board window** (Swift): kanban of cards; open one to read its blueprint, approve, edit, answer its questions, see the result, keep or undo. All without a terminal | ◐ | Wanted 2026-11-15: reading and answering cards in the CLI isn't pleasant. The CLI stays for scripts and agents |
| **Picture first**: blueprint shown as a diagram before the text, with "Redraw" | ◐ | Native 4-box map built; diagram-design (MIT) for richer diagrams next |
| **Cookie icon eaten bite by bite**: one bite per ~1/8 of the window used, so what's left on the plate is what Chompyy can still eat | ✅ | Idea from claude-codex-battery (MIT, Swift). Bites are scalloped tooth marks around the edge, not clean pie wedges, which would look like Pac-Man |
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
- **Measure the premise**: how often a 5-hour window resets with capacity left *and* the weekly limit isn't binding. Without that, "saved capacity" claims aren't proven.

## 11. Proof: evals and benchmarks

Numbers that make the pitch convincing to people who doubt it. Eval projects: [feature-inspiration §10](research/feature-inspiration.md).

| Measure | How | Status |
|---|---|---|
| **The premise**: share of 5-hour windows that reset with capacity left while the weekly limit isn't binding | From saved quota snapshots and transcripts, across volunteer users | 📋 first |
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

## Open questions



- Provider terms on automated use of subscription plans (Chompyy presents runs as approved, useful work; no warm-up pings without checking).
- Trademark search for "Chompyy" (`chompyy` is free on npm).
