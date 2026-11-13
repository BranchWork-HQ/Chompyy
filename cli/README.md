# chompyy (CLI)

Uses the capacity in Claude Code's 5-hour window that would otherwise reset unused. You park ideas as cards, each card gets a short **blueprint** (the scope agreed before it runs), approved cards run headless while you're away, and a report shows what ran so you can rate it.

This is the MVP from [the spec](../research/spec-token-utilization.md) §10, CLI only. Node 20+, no runtime dependencies.

## Install

```bash
cd cli
npm install          # also builds dist/
npm link             # puts `chompyy` on your PATH
chompyy help
```

Without linking: `npx chompyy help` from inside `cli/`, or `node cli/dist/cli.js help`.

You also need [Claude Code](https://code.claude.com) (`claude` on your PATH) for blueprints and away runs, on a Pro, Max or Ultra plan for the quota numbers.

## Set up the quota snapshot

Chompyy reads quota from Claude Code's status line, never by sending a message (if no window is active, the first message would start a new 5-hour window). Add this to `~/.claude/settings.json`:

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

## Two-minute walkthrough

```bash
cd ~/code/my-repo
chompyy later "Add a --json flag to the export script, with a test"
#  📥 #1 parked in later · drafting the blueprint in the background

chompyy show 1          # read the blueprint (Goal / Scope / Out of scope / Shape / How it's checked)
chompyy blueprint 1     # not happy? draft it again (or --model sonnet)
chompyy approve 1       # later → approved; needs a blueprint
chompyy status          # 5h left, reset time, pace, weekly used
chompyy away 1h --dry-run   # the plan: which cards, where they'd run, whether the gate is open
chompyy away 1h         # go get lunch; cards run one at a time, then move to review
chompyy report          # what ran since the last report, with the first lines of each result
chompyy rate 1 4 "right scope, test was thin"
chompyy board           # everything, by column
```

Each card in a git repo runs in its own worktree at `~/.chompyy/worktrees/<id>` on a new branch `chompyy/<id>`; review it with `git log chompyy/1` or `git diff HEAD...chompyy/1` in your repo, and merge it yourself if you like it. Cards outside git run in `~/.chompyy/runs/<id>/work/`.

`away` runs in the foreground and needs the terminal to stay open; for a long run use `nohup chompyy away 1h > ~/.chompyy/away.log 2>&1 &`, or tmux. Claude Code may warn that a sign-in expires; for unattended jobs it suggests `claude setup-token`.

## Commands

| Command | What it does |
|---|---|
| `chompyy statusline` | Status line hook: reads Claude Code's JSON on stdin, saves the snapshot, prints one line |
| `chompyy status` | % left in the 5h window, time to reset, per-hour pace, weekly used, stale or not |
| `chompyy later "<idea>"` | New card in *later*, remembering the current directory. Drafts the blueprint in the background when `claude` is available (`--wait` to wait for it, `--no-blueprint` to skip) |
| `chompyy board [--column approved]` | Cards by column: suggested, later, approved, running, review, done |
| `chompyy show <id>` | One card with its blueprint, last run and rating |
| `chompyy blueprint <id> [--model m]` | Draft (or redraft) the blueprint with a cheap model |
| `chompyy approve <id>` / `drop <id>` | Queue a card for away runs / remove it (kept in `archive.jsonl`) |
| `chompyy away <1h\|30m\|1h30m> [--dry-run] [--force]` | Run approved cards until the time is up or the gate closes |
| `chompyy report [--all]` | Cards that ran since the last report |
| `chompyy rate <id> <1-5> ["why"]` | Rate a result against its blueprint; moves it to *done* and logs a signal |
| `chompyy taste` | Show `taste.md` (a stub for now; nothing is distilled yet) |

## The budget gate

Before each card, `away` checks the snapshot and stops when:

- the 5h window has less than `min5hLeftPct` left (default 10%),
- weekly usage is over `100 − weeklyReservePct` (default: stop above 90%, keeping 10% of the week),
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
| `weeklyReservePct` | `10` | % of the weekly allowance to keep |
| `permissionMode` | `"acceptEdits"` | `--permission-mode` for away runs: file edits allowed, other tools only if allowed below |
| `permissionPrompts` | `"none"` | `--permission-prompts`: anything that would ask for permission is denied, so a run never hangs waiting. Set `null` on Claude Code versions without this flag |
| `allowedTools` | read/search tools, `git status/diff/log/add/commit`, `npm test`, `npm run`, `npx vitest`, `pytest` | `--allowedTools` |
| `disallowedTools` | `git push/merge/rebase/reset/checkout/switch/worktree`, `gh`, `npm publish`, `curl`, `rm -rf` | `--disallowedTools` |
| `extraArgs` | `[]` | Appended to every away-run `claude -p` call, e.g. `["--max-budget-usd", "2"]` for API-key users |

Set `CHOMPYY_HOME` to keep state somewhere other than `~/.chompyy` (the tests do this).

## Safety rules

A card runs unattended only inside a box (spec §5.5):

- **Its own place**: a fresh git worktree on `chompyy/<id>`, or a draft folder under `~/.chompyy/runs/<id>/`. Your checkout is never touched; nothing is merged.
- **Rules in the prompt**, before the blueprint: work only inside this directory; no git push, merge, rebase or PR; no sending, posting, publishing or purchases; if a decision is needed, stop and write `QUESTIONS.md` (the report flags those cards as ❓).
- **Rules in the tools**: `acceptEdits` plus an allow list, a deny list for push/merge/`gh`/publish, and `--permission-prompts none` so anything outside the lists is refused instead of waiting for you.
- **Caps**: a wall-clock timeout per card, a turn cap, the away duration, and the budget gate above.
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
| `signals.jsonl` | One line per rating: card, rating, reason, blueprint (input for the future taste distiller) |
| `taste.md` | What's been learned; edit freely |
| `archive.jsonl` | Dropped cards |
| `state.json` | When the last report was shown |
| `config.json` | Your settings |

## Develop

```bash
npm test         # vitest
npm run build    # tsc → dist/
```
