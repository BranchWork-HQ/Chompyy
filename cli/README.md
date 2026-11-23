# chompyy (CLI)

Uses the capacity in Claude Code's 5-hour window that would otherwise reset unused. You park ideas as cards, each card gets a short **blueprint** (the scope agreed before it runs), approved cards run headless while you're away, and a report shows what ran so you can rate it.

This is the MVP from [the spec](../research/spec-token-utilization.md) §10, CLI only. Node 20+, no runtime dependencies.

## Install

```bash
npm install -g chompyy
chompyy help
chompyy app          # macOS: install the menu bar app too
```

From source:

```bash
cd cli
npm install          # also builds dist/
npm link             # puts `chompyy` on your PATH
chompyy help
```

Without linking: `npx chompyy help` from inside `cli/`, or `node cli/dist/cli.js help`.

You also need [Claude Code](https://code.claude.com) (`claude` on your PATH) for blueprints and away runs, on a Pro, Max or Ultra plan for the quota numbers.

## Quota

By default Chompyy reads live quota with Claude Code's saved login (macOS Keychain or `~/.claude/.credentials.json`), from the same usage endpoint Claude Code's `/usage` shows. It sends no message, so it never starts a window, and it checks at most every 5 minutes. Nothing to set up. To use only the status line instead, set `"quotaSource": "statusline"` in `~/.chompyy/config.json`.

### Pacing

```
🍪 5h 22% left ⇡41% · 3h07m · limit ~20:24 | 7d 24% used ⇣7%
```

- **Pace delta**: used % minus the % of the window that has passed. `⇣` (green) is headroom, `⇡` (red) is burning faster than an even pace.
- **Forecast**: from your pace over the last hour (or your average this window), how much of the 5-hour window will reset unused (`~40% unused at 18:20`, the moment to give Chompyy a card), or when you'll hit the limit first. Once a limit is hit it stops projecting and shows when it resets.
- **Today** (`chompyy status`): what's left of the week ÷ the days left, where your day ends at your `bedtime` (midnight if unset), with on pace / ahead / behind / over. It needs a reading from before today to judge; until then it shows the allowance only.
- **Per-model weekly limits** (e.g. Opus) appear in `chompyy status` when your plan has them, and the gate respects them: a run on a model whose weekly window is over the hard stop doesn't start.

The rate comes from a small history of quota readings (`quota-history.json`, 8 days), saved whenever the numbers change; no extra calls.

## Set up the quota snapshot (fallback)

Chompyy can also read quota from Claude Code's status line, never by sending a message (if no window is active, the first message would start a new 5-hour window). Add this to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "chompyy statusline"
  }
}
```

Each status line refresh writes `~/.chompyy/quota.json` and shows one line:

```
🍪 5h 62% left · 1h40m · ~37%/h | 7d 41% used
```

That reads: 62% of the 5h window left, it resets in 1h40m, so about 37% per hour is available until then; 41% of the weekly limit is used. `rate_limits` only appears after the first reply of a session; until then the last snapshot is kept. Once the window's `resets_at` has passed, the snapshot is stale and Chompyy treats the window as unknown.

If you already have a status line command, keep it and call Chompyy from a small wrapper: save stdin to a variable, pipe it to `chompyy statusline`, and print both.

## Get to know you (cold start)

```bash
chompyy history            # what it would read: sessions, projects, dates (local, sends nothing)
chompyy history --digest   # the exact text it would send
chompyy coldstart          # one model call: proposes taste lines and suggested cards
chompyy coldstart accept --taste t1,t2 --cards c1    # the rest are declined
chompyy keep-history 365   # Claude Code deletes transcripts after 30 days by default
```

Only interactive sessions are read (headless runs are skipped). Each proposal must cite your sessions: a taste line needs 3 separate sessions, and a card's quote must really appear in what you said. Anything that doesn't check out is thrown away.

## Two-minute walkthrough

```bash
cd ~/code/my-repo
chompyy later "Add a --json flag to the export script, with a test"
#  📥 #1 parked in later · drafting the blueprint in the background

chompyy show 1          # read the blueprint (Goal / Scope / Out of scope / Shape / How it's checked)
chompyy blueprint 1     # not happy? draft it again (or --model sonnet)
chompyy approve 1       # later → approved; needs a blueprint
chompyy status          # 5h left, reset time, pace, weekly used
chompyy eat-tokens      # read-only view of the leftover window and cards to consider
chompyy away 1h --dry-run   # the plan: which cards, where they'd run, whether the gate is open
chompyy away 1h         # go get lunch; cards run one at a time, then move to review
chompyy report          # what ran, and the one thing to do about each (cards that need you first)
chompyy diff 1          # see the change; then keep it, or throw it away
chompyy keep 1          # merge its branch into your current branch  (or: chompyy undo 1)
chompyy rate 1 4 "right scope, test was thin"
chompyy board           # everything, by column
```

Each card in a git repo runs in its own worktree at `~/.chompyy/worktrees/<id>` on a new branch `chompyy/<id>`; review it with `git log chompyy/1` or `git diff HEAD...chompyy/1` in your repo, and merge it yourself if you like it. Cards outside git run in `~/.chompyy/runs/<id>/work/`.

`away` runs in the foreground and needs the terminal to stay open; for a long run use `nohup chompyy away 1h > ~/.chompyy/away.log 2>&1 &`, or tmux. Claude Code may warn that a sign-in expires; for unattended jobs it suggests `claude setup-token`.

## Commands

| Command | What it does |
|---|---|
| `chompyy statusline` | Status line hook: reads Claude Code's JSON on stdin, saves the snapshot, prints one line |
| `chompyy status` | % left in the 5h window, time to reset, weekly used, pace delta, forecast, today's allowance, per-model weekly windows |
| `chompyy eat-tokens` | Read-only view of remaining 5h quota and approved/later cards; starts nothing |
| `chompyy later "<idea>"` | New card in *later*, remembering the current directory. Drafts the blueprint in the background when `claude` is available (`--wait` to wait for it, `--no-blueprint` to skip). The card starts titled with the idea's first 60 characters; with the blueprint the same model writes a title of 10 words or fewer (one extra short call, no tools). If that call fails, the first title stays |
| `chompyy board [--column approved]` | Cards by column: suggested, later, approved, running, review, done |
| `chompyy show <id>` | One card with its blueprint, last run and rating |
| `chompyy blueprint <id> [--model m]` | Draft (or redraft) the blueprint with a cheap model |
| `chompyy picture <id> [--model m]` | Draw (or redraw) the card's picture: a diagram of what it will do, made with the diagram-design skill. Happens on its own after each blueprint while a window is active (`"pictures": false` in config.json turns it off) |
| `chompyy edit-idea <id>` | Replace a *later* card's idea (and its title) with text from stdin, e.g. `echo "new idea" \| chompyy edit-idea 3`. The blueprint stays; redraft it with `blueprint <id>` |
| `chompyy approve <id>` / `drop <id>` | Queue a card for away runs / remove it (kept in `archive.jsonl`) |
| `chompyy away <1h\|30m\|1h30m> [--dry-run] [--force]` | Run approved cards until the time is up or the gate closes |
| `chompyy report [--all]` | Cards that ran since the last report: one action each, cards needing you first. No paths or raw agent text; ask for those with `show` |
| `chompyy diff <id>` | The change the card made on its branch |
| `chompyy keep <id>` | Merge the card's branch into your current branch and remove its worktree. Refuses when you have unsaved changes in a file the card also changed, or anything staged; other unsaved work is left alone |
| `chompyy undo <id>` | Throw the run away: remove its worktree and branch (or draft folder). Your own branches are never touched |
| `chompyy rate <id> <1-5> ["why"]` | Rate a result against its blueprint; moves it to *done* and logs a signal |
| `chompyy taste` | Show `taste.md` |
| `chompyy taste list` / `why <id>` | Every learned preference and its status / the cards, edits and quotes behind one |
| `chompyy taste yes\|not-now\|never <id>` | Answer the report's question. Only *yes* writes it to `taste.md`; *never* stops Chompyy proposing it again |
| `chompyy taste retire <id>` | Stop using a preference; it stays in `taste list` with the reason |
| `chompyy distill [--force]` | Read new signals and update preferences now (also runs after every away run) |
| `chompyy trends` | Last 7 days vs the 7 before: cost per card, keep rate, rating, blueprint edits |
| `chompyy detect [--days 30] [--json]` | The detective: what wastes tokens in your setup and habits, from your own files, each finding with its count, measured or estimated, what it doesn't prove, and the smallest fix. This version checks startup tax (long CLAUDE.md, unused skills and MCP servers, cut-off MEMORY.md) and cache (cold returns, mid-session rebuilds). Reads only; changes nothing |
| `chompyy triggers on\|off` | Install or remove the macOS LaunchAgent that runs `chompyy tick` every 5 minutes |
| `chompyy bedtime <23:30\|off>` / `last-hour <on\|off>` / `missed-reset <on\|off>` | Turn the bedtime, last-hour-before-reset and missed-reset (first tick after an unused reset, default off) triggers on or off |

## Taste

Chompyy learns how you like work done from what you do with results, not from what you tell it:

1. **Signals** collect in `signals.jsonl`: ratings and their reasons, "what would have made it a 5?" picks, blueprint edits, keep and undo, answers. Only cards you approved, ran or rated count; drafts you dropped don't.
2. **The distiller** (`distillModel`, default sonnet; one model call, only inside an active window) reads new signals and proposes preferences. Each one must cite signals, and the citations are checked, so it can't invent evidence.
3. **Asked, not assumed.** A preference becomes a question after 3 separate cards, or after one if you said it yourself in a rating. The report asks at most one question, strongest evidence first.
4. **Yes** writes it to `taste.md` with a valid-from date, and away runs get `taste.md` in their prompt. Contradicted or removed preferences are retired with the reason, never silently deleted. Delete a learned line from `taste.md` and that preference is retired: your edits win.

## Triggers

`chompyy triggers on` installs a LaunchAgent (`~/Library/LaunchAgents/dev.chompyy.tick.plist`) that runs `chompyy tick` every 5 minutes. Nothing fires until you turn it on. A tick starts an away run when:

- **last hour**: the 5-hour window resets within the hour with at least `lastHourMinLeftPct` left (default 25%); once per window;
- **bedtime**: it's within `bedtimeWindowMin` (default 60) of your `bedtime`; once a night. At bedtime it also distils taste when there's something new.

Either way the run lasts until 2 minutes before the reset, the budget gate still decides every card, and only one away runs at a time (`away.lock`). Ticks are logged to `tick.log`.

## Cost ranges

Each run records what it used of your windows: 5-hour and weekly quota after the card minus before (it also counts anything else you did at the same time, so it's an upper bound). A card that hasn't run shows a range from similar past runs (`show`, `eat-tokens`): min–max at first, P10–P90 once there are 5 or more.

## The budget gate

Before each card, `away` checks the snapshot and stops when:

- the 5h window has less than `min5hLeftPct` left (default 10%),
- weekly usage is ahead of an even pace through the week (e.g. 2.5 days into the week, more than ~36% used): it spends only what you haven't used so far and never borrows from the days ahead (`weeklyPace`),
- weekly usage is over `100 − weeklyReservePct` (hard stop, default above 90%, whatever the pace),
- the 5h window is unknown: no snapshot, or its `resets_at` has passed. Running then would start a *new* window instead of using leftover capacity. Open Claude Code once to refresh it, or pass `--force`.

An unknown weekly window doesn't close the gate (some plans don't report it); `away` says it wasn't checked. The snapshot doesn't move during an away run (no interactive session updates it), so in practice the gate stops the run when the window resets.

## Config

`~/.chompyy/config.json`; any key you leave out keeps its default.

| Key | Default | Meaning |
|---|---|---|
| `claudeBin` | `"claude"` | The Claude Code binary |
| `blueprintModel` | `"haiku"` | Model that drafts blueprints (`claude -p --model haiku --tools ""`) |
| `runModel` | `null` | Model for away runs; `null` uses Claude Code's default |
| `cardTimeoutMin` | `30` | Wall-clock cap per card, in minutes; also capped by the time left in the away run |
| `maxTurns` | `50` | Passed as `--max-turns`. `claude --help` (2.1.322) doesn't list it, but `claude -p` accepts it; set `null` if your version rejects it |
| `min5hLeftPct` | `10` | Minimum % left in the 5h window to start a card |
| `weeklyPace` | `true` | Only run while weekly usage is behind an even pace through the week |
| `weeklyReservePct` | `10` | Hard stop: never run above `100 − this` % weekly used |
| `permissionMode` | `"acceptEdits"` | `--permission-mode` for away runs: file edits allowed, other tools only if allowed below |
| `permissionPrompts` | `"none"` | `--permission-prompts`: anything that would ask for permission is denied, so a run never hangs waiting. Set `null` on Claude Code versions without this flag |
| `allowedTools` | read/search tools, `git status/diff/log/add/commit`, `npm test`, `npm run`, `npx vitest`, `pytest` | `--allowedTools` |
| `disallowedTools` | `git push/merge/rebase/reset/checkout/switch/worktree`, `gh`, `npm publish`, `curl`, `rm -rf` | `--disallowedTools` |
| `sandbox` | `true` | Run away cards in Claude Code's OS sandbox (macOS, Linux, WSL2) |
| `sandboxAllowedDomains` | `[]` | Domains sandboxed commands may reach, e.g. `["registry.npmjs.org"]` |
| `extraArgs` | `[]` | Appended to every away-run `claude -p` call, e.g. `["--max-budget-usd", "2"]` for API-key users |
| `denyReadPaths` | `~/.ssh`, `~/.aws`, `~/.gnupg`, … | Never readable by away runs (sandbox `denyRead` + `Read(...)` deny rules) |
| `loopRepeat` | `5` | Circuit breaker: stop a card that repeats the same tool call this often; `0` = off |
| `independentCheck` | `true` | Run the repo's tests after each card, sandboxed (macOS) |
| `checkTimeoutMin` | `10` | Time limit for that check |
| `checkCommands` | `{}` | Test command per repo when the detected one is wrong, e.g. `{"/Users/me/app": "npm run test:unit"}` |
| `suggestedExpiryDays` | `14` | Archive suggested cards untouched this long; `0` = never |
| `distillModel` | `"sonnet"` | Model that distils taste from your signals |
| `distillAfterAway` | `true` | Distil after each away run when there are new signals |
| `lastHourTrigger` | `true` | Last-hour trigger (only fires once `chompyy triggers on`) |
| `lastHourMinLeftPct` | `25` | Last-hour trigger needs at least this much of the window left |
| `bedtime` | `null` | Bedtime trigger as `"23:30"`; `null` = off |
| `bedtimeWindowMin` | `60` | How long after bedtime it may still start |

Set `CHOMPYY_HOME` to keep state somewhere other than `~/.chompyy` (the tests do this).

## Safety rules

A card runs unattended only inside a box (spec §5.5):

- **Its own place**: a fresh git worktree on `chompyy/<id>`, or a draft folder under `~/.chompyy/runs/<id>/`. Your checkout is never touched; nothing is merged.
- **Rules in the prompt**, before the blueprint: work only inside this directory; no git push, merge, rebase or PR; no sending, posting, publishing or purchases; if a decision is needed, stop and write `QUESTIONS.md` (the report flags those cards as ❓).
- **Enforced by the OS** (default, `sandbox: true`): cards run in Claude Code's sandbox. Shell commands can write only inside the card's folder (plus its repo's `.git`, so commits work) and have **no network** unless you list domains in `sandboxAllowedDomains`. So a `git push` fails even if a test script tries it. If the sandbox can't start, the card refuses to run rather than run unprotected. Checked on macOS with a real headless run: network and outside writes were blocked, the commit worked. Credential folders (`denyReadPaths`: `~/.ssh`, `~/.aws`, `~/.gnupg`, cloud CLI configs, `.netrc`, `.npmrc`, Keychains, …) can't be read, by shell commands or by the file tools; other reads are allowed.
- **Rules in the tools**: `acceptEdits` plus an allow list, a deny list for push/merge/`gh`/publish, and `--permission-prompts none` so anything outside the lists is refused instead of waiting for you.
- **Caps**: a wall-clock timeout per card, a turn cap, the away duration, and the budget gate above. The gate never lets a card start past 100% of a window, so a plan with extra usage turned on is never billed by Chompyy.
- **Circuit breaker**: away runs are watched as they happen. The same tool call 5 times in the last 20, or the same shell command failing 4 times in a row, stops the card (⛔ *stuck* in the report). `loopRepeat` sets the number; `0` turns it off.
- **Independent check**: after a run, Chompyy runs the repo's own tests itself (`npm test`, `go test`, `cargo test --offline`, `pytest`, `make test`; set your own per repo in `checkCommands`). They run in a macOS sandbox: writes only in the card's folder, no network, no credential reads. A fresh worktree has no `node_modules`, so your checkout's is linked in for the check. The report trusts this result over what the agent says. If a failure looks like the sandbox blocked something (a write outside the folder, the network), the report says so instead of calling the change broken. Skipped on other systems; `independentCheck: false` turns it off.
- **Overlaps**: approving a card warns when a queued or unreviewed card looks like it touches the same files.
- **Blueprint first**: a card can't be approved without one.

These lower the risk; they don't make it zero. Read the result (and its branch) before you merge anything.

## Agent shortcuts (Claude Code skills)

`skills/` holds `/later`, `/eat-tokens`, `/away` and `/taste`. Each one shells out to `chompyy`. Install them for all your projects by linking them into your personal skills folder:

```bash
mkdir -p ~/.claude/skills
for s in later eat-tokens away taste; do ln -s "$PWD/skills/$s" ~/.claude/skills/$s; done   # run from cli/
```

Or copy them into a project's `.claude/skills/` to scope them to that repo.

## Files

Everything is plain JSON or Markdown in `~/.chompyy/`:

| File | What |
|---|---|
| `quota.json` | Last quota snapshot |
| `board.json` | Cards, with blueprints, run info and ratings |
| `runs/<id>/<time>.log` | Prompt, output and errors of each run |
| `worktrees/<id>/` | Git worktrees of cards that ran in a repo |
| `signals.jsonl` | Everything you did that teaches taste: ratings, blueprint edits, keep/undo, answers, taste answers |
| `preferences.json` | Learned preferences with evidence, status, valid-from and retired-because |
| `taste.md` | What's been learned and confirmed, plus your own lines; edit freely |
| `runs.jsonl` | One line per run: duration and what it used of the 5-hour and weekly windows |
| `triggers.json` / `tick.log` | What fired, and what each tick decided |
| `archive.jsonl` | Dropped cards |
| `state.json` | When the last report was shown |
| `config.json` | Your settings |

## Develop

```bash
npm test         # vitest
npm run build    # tsc → dist/
```
