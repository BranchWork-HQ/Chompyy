# Chompyy: spec (draft)

> **It learns your taste, suggests the tasks you'd want done, and runs them while you're away, so tokens that would reset unused become work waiting for you when you're back.**

Status: draft, 2026-11-13. Nothing is built. Decisions here come from the research in this repo and the design conversations recorded in [issue #2](https://github.com/BranchWork-HQ/Chompyy/issues/2). Card IDs (A1, C2, …) refer to [atomic-knowledge.md](atomic-knowledge.md).

## 1. The problem

Subscription plans (Claude Pro/Max, ChatGPT plans for Codex, …) give a usage window that resets every 5 hours, plus a weekly limit. Three things go wrong:

1. **Capacity resets unused.** Overnight, during lunch or the gym, or in the last hour before a reset, the window has room left and nobody uses it. Under flat pricing the provider has no reason to help you use it.
2. **Waiting drains people.** You delegate an idea the moment it comes up, then either juggle several sessions (tiring) or scroll something else while you wait.
3. **Vague requests waste runs.** The first result misses what you pictured, so you re-explain and re-run. That costs tokens and, more importantly, your time.

Token *optimization* (compression, routing, terse output) is a crowded field; token *utilization* is not. The survey's "schedule" angle has 5 tools, all ≤ 182 ⭐, each doing one piece, and none decides **what** to run ([landscape](landscape-2026-11.md)).

## 2. What success means

| Metric | Why |
|---|---|
| **Accepted results from capacity that would have reset unused** | The main goal. Tokens burned on work nobody wanted don't count |
| **Acceptance rate** of background results | Warning sign: low acceptance means Chompyy is creating review work, not saving time |
| **User effort per task** (corrections, reruns, ⭐ vs blueprint) | Taste and blueprints exist to push this down |
| Utilization of windows (% that reset with capacity left) | Secondary; useful only alongside the three above |

Long-run goal: **more completed tasks per weekly allowance**, for heavy users (stretch it) and light users (stop losing it).

## 3. Not in v1

Token optimization features (they come later, built on [atomic-knowledge.md](atomic-knowledge.md)) · calendar integration (v2) · Windows and Linux (codeburn shows the path later) · API-billed usage · running tasks with agents that have no headless mode.

## 4. The loop

```
 day      /later <idea> → blueprint drafted in background → card parked
          long wait on a run? → review 1–2 cards instead of scrolling
          /eat-tokens → "what can I run with what's left?" → pick cards
    │
 away     /away 1h, bedtime, or "40 min to reset, 35% left"
          → approved cards that fit the time and the leftover run headless
    │
 back     "While you were away": what ran, what to review → rate vs blueprint
    │
 night    ratings, blueprint edits and corrections → distilled into taste.md
```

## 5. Features

### 5.1 Quota reader

| Source | Notes |
|---|---|
| Claude Code status line JSON: `rate_limits.five_hour` / `.seven_day` → `used_percentage`, `resets_at` | Documented ([statusline docs](https://code.claude.com/docs/en/statusline)). Pro, Max and Ultra only; present only inside a live session after its first reply |
| Snapshot file | Chompyy's status line hook writes the last values to disk on every run. Once you leave, your usage stops, so the snapshot stays accurate until `resets_at` |
| Other tools | Follow Orca's providers (`src/main/rate-limits/providers/`: claude, codex, cursor, gemini, grok, kimi, …) |

Rules:
- **Never probe by sending a message.** If no window is active, the first message starts a new 5-hour window.
- **Show percentages and pace, not pressure:** "35% left · 40 min → about 52% per hour available".
- Don't rely on the undocumented OAuth usage endpoint in v1.

### 5.2 Waste detector (when to offer)

v1 triggers:
1. **Last hour before a reset** with capacity left.
2. **`/away <duration>`**, when you say you're stepping out.
3. **Bedtime**, set once.

Before offering, check the weekly limit by **staying on pace**: run only while weekly usage is behind an even pace through the week (2.5 days into a 7-day week, under ~36% used). That spends only what you haven't used so far and never borrows from the days ahead. A hard stop at 90% weekly used applies whatever the pace. (Decided 2026-11-14, replacing "keep 10% of the remaining weekly allowance", which shrinks as you spend.) An unused window is only lost if the weekly limit isn't binding, so measure how often that's true from real logs before claiming savings.

### 5.3 The board

```
 💡 Suggested      📥 Later        ✅ Approved       ⚙️ Running     👀 Review → ⭐
 (on request)     (you parked)    (blueprint OK)    (headless)     (rate vs blueprint)
```

- **Suggested** cards appear **only when asked** (`/eat-tokens`). No automatic suggestions, so no noise. How often you ask decides how many Chompyy prepares.
- Suggestions come from: unfinished ideas and "let's do that later" in history, TODOs the agent left, tasks abandoned halfway, routines repeated 3+ times, and work related to what you're doing now.
- **Later** cards come from `/later <idea>`: you park a stray idea without switching tasks.
- Stale cards expire.

### 5.4 Blueprint (before every run)

Drafted by a cheap model (BranchWork's Quote does this for about $0.001). It contains:
- **Goal** in one line
- **Scope**: 3–5 bullets of what you'll get, and what's out of scope
- **Shape**: an outline or small flowchart of the artifact
- **Cost range** from similar past runs, as a range (models predict their own spend poorly, r ≤ 0.39, B4). It narrows as history grows
- **How it's checked**: tests, files, cited sources

It does three jobs: clarifies a vague request before spending, sets the agent's goal and boundary, and gives the rating something fair to compare against.

### 5.5 Safety gate (what may run unattended)

A card may run while you're away only if:
- it needs **no decisions** from you partway through,
- its result can be **checked** without you,
- it runs in its **own git worktree or draft folder** and is reversible,
- it does **nothing outward**: no push, merge, send, post or purchase,
- nothing you're doing today is **waiting on it**.

### 5.6 Runner

Headless agents per tool: `claude -p` (v1), then `codex exec`, `cursor-agent`, … Each run gets a worktree, a budget cap from the leftover window, and a turn cap (E1). Reference: Orca's automations (`src/main/automations/`: launch, run history, usage per run).

### 5.7 "While you were away" report

What ran, what each card produced, what needs review, and a one-tap rating against its blueprint. Over time it also reports the effect: "paper digests: −31% tokens, −1.2 corrections vs last month", measured from real runs (paired replays where possible, B4–B6).

### 5.8 Taste

**Signals**, strongest first: edits to the blueprint before approving · edits to the result afterwards · corrections in chat · ratings (plus an optional one-line reason) · accepted vs rejected suggestions.

**Distillation**: a nightly job proposes candidate preferences. A preference enters taste.md only after **3 separate confirmations**, and is removed when contradicted (G2). Learn only from rated or approved work, never from unrated runs (G5).

**taste.md**: plain text, grouped by scope, each line with its evidence. **User edits always win.**

```markdown
## Everywhere
- Prefers tables over long prose for comparisons  (seen 7× · last 2026-11-12)

## Research digests
- 5 bullets max, each with a source link          (seen 4×)
```

Only the relevant sections load at session start, so the startup stays small and fixed for the session (A1, E2).

**Event memory** (who you are, past events) is separate and **off by default per conversation**. Recalling it in unrelated chats is what users find intrusive, and it adds irrelevant context (C3).

**The moat** is the distiller (which signals count, how they're weighted, when a pattern becomes a preference) and the accumulated signal history. The file itself stays fully visible, so users never have to guess what was noticed.

### 5.9 Cold start from history

On install, Chompyy reads existing session history so a new user doesn't start from zero. It produces a first taste.md and first suggestions for the user to review.

- Readers: follow codeburn's approach (42 tools, one file per tool, `src/providers/`).
- Claude Code deletes transcripts after about 30 days by default (`cleanupPeriodDays`). Read history at install, and offer to raise that setting.
- Prior art mines transcripts for CLAUDE.md rules (headroom `learn`, ratchet, distil, ferret, agent-knowledge, all small). None we found suggests **tasks** from history.

## 6. Commands

| Command | What it does |
|---|---|
| `/eat-tokens` | What can I run with what's left? Suggestions on request; start the ones you pick |
| `/later <idea>` | Park an idea; the blueprint is drafted in the background |
| `/away 1h` | Run approved cards while you're gone |
| `/taste` | See and edit what's been learned |

The same actions live in the menu bar app for people who never open a terminal.

## 7. Architecture

```
 ┌──────── Swift / SwiftUI menu bar app (thin UI, macOS first) ────────┐
 └───────────────────────────────┬──────────────────────────────────────┘
                                 │ calls
 ┌──────── TypeScript core + CLI (chompyy) ─────────────────────────────┐
 │ board · blueprints · taste · waste detector · scheduler · report     │
 ├──────────────┬────────────────────┬──────────────────────────────────┤
 │ history       │ quota readers      │ runners (headless agents)        │
 │ readers       │                    │                                  │
 └──────────────┴────────────────────┴──────────────────────────────────┘
   skills per agent (/eat-tokens …) are optional shortcuts into the CLI
```

Same split as codeburn (`src/` TypeScript CLI + `mac/` Swift menu bar that calls it). A TypeScript core lets us reuse borrowed code directly.

| Borrow from | What | Licence |
|---|---|---|
| [codeburn](https://github.com/getagentseal/codeburn) `src/providers/`, `mac/` | Session readers for 42 tools; menu bar app structure | MIT |
| [Orca](https://github.com/stablyai/orca) `src/main/rate-limits/providers/`, `src/main/automations/` | Quota readers for 11 tools; scheduled runs with usage per run | MIT |
| rtk (later, for optimization) | Compress output before it enters history | Apache-2.0 |

Keep the copyright notices of anything copied (a `THIRD_PARTY_NOTICES` file, as codeburn does). Orca's code sits inside an Electron app, so expect some untangling, not copy-paste.

## 8. Privacy notice (shown before reading any history)

- **Reads**: session files of the tools and projects you choose.
- **Runs**: on your machine. Nothing is uploaded beyond the model calls your agents already make.
- **Keeps**: taste.md and the board, as plain files you can read and delete. Raw transcripts are never copied.
- **Skips**: anything that looks like a secret (keys, tokens, `.env` contents) is filtered before analysis.
- **Control**: you approve the first taste.md before it's used; one command forgets everything.

## 9. Risks and open questions

| Risk | What to do |
|---|---|
| Unused windows may not be "lost" for users who hit the weekly limit anyway | Measure from real logs (own + volunteers) before claiming impact |
| Provider terms on automated use of subscription plans | Read current terms; present Chompyy as approved, useful work, not "burn the plan"; no warm-up pings without checking (BranchWork #111) |
| Background results create review burden | Acceptance rate is a first-class metric; blueprints and taste keep quality up |
| A provider ships a general "background tasks" feature | The defence is the *what*: taste, suggestions, blueprints, proof |
| Tools without a headless mode | Read and suggest for them; run only where possible |
| Name and mascot | `chompyy` is free on npm; trademark search still to do |

## 10. v1 milestone

1. Quota snapshot from Claude Code's status line, shown as % left and per-hour pace in the menu bar.
2. `/later` and `/eat-tokens` with blueprints; the board.
3. `/away` and the last-hour trigger running approved cards via `claude -p` in worktrees.
4. The report, with rating against the blueprint.
5. History cold start for Claude Code, with the privacy notice → first taste.md.

**v1 is proven** when, over 2 weeks of real use, it shows accepted results from windows that would have reset unused, with an acceptance rate worth the review time.

## 11. Later

Google Calendar (free/busy only) to propose away windows · Cursor and Codex history and runners · the optimization side (cache-aware session policy, compression before history) · Windows and Linux.

## 12. Mascot

**Chompyy**: a chocolate cookie with a real bite taken out of it (scalloped tooth marks, not a clean wedge, so it can't be mistaken for Pac-Man). Chocolate chips for eyes, crumbs falling from the bite. Hand-drawn.
