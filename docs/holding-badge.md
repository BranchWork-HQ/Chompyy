# The "Holding" badge on the board

Question (task #16): "On the main board, not sure what the holding button is doing? Do we really need that button?"

Short answer: it is not a button. It is a status pill that says whether Chompyy would start an away run right now. Keep it, but make it say why. Recommendation below.

Line numbers are from commit `e1a888c`.

## What it shows

- **It's a label, not a button.** `GateBadge` is a SwiftUI `Label` inside a coloured capsule (a rounded pill shape). It has no tap action. See `mac/Sources/Chompyy/Board.swift:136-149`. (The blueprint guessed lines 130-142. The struct actually starts at line 136.)
- **Two states.** It shows green "Ready to run" with a check mark when the gate is open, and orange "Holding" with a pause icon when it is closed (`Board.swift:141`, colours at `Board.swift:145-146`).
- **Where it sits.** It's at the far right of the quota header, after the 5-hour cookie and the "This week" bar (`Board.swift:87`).
- **The reasons are hidden in a tooltip.** A tooltip is the small text box macOS shows when you hold the mouse still over something. The pill's tooltip lists the gate's reasons and notes (`Board.swift:147`). If you never hover, you never see why it's holding.
- **Where the data comes from.** The app runs `chompyy state`. That command includes `gate: budgetGate(...)` in its JSON (`cli/src/appstate.ts:89`), and the app decodes it as `Gate { ok, reasons, notes }` (`mac/Sources/Chompyy/Models.swift:66-70`).

"Gate" here means the budget gate. It's a check Chompyy makes before it spends your quota on an away run, so it only uses quota that would otherwise go to waste. It's the same check that actually stops runs:

| Who asks the gate | What happens if it's closed | Source |
|---|---|---|
| Away run, before each card | Stops the run, or waits for the 5h reset if the 5h window is the only problem | `cli/src/away.ts:209-229` |
| Automatic triggers | Don't fire (`gate closed: ...`) | `cli/src/triggers.ts:90-91` |
| `chompyy away` in the terminal | Prints `gate closed` plus the reasons before it starts | `cli/src/cli.ts:828-830` |

So "Holding" means: if you clicked Away now (or a trigger fired), no card would start. The Away menu itself doesn't check the badge. It launches `chompyy away <duration>` (`mac/Sources/Chompyy/Store.swift:98`), and the gate stops the run right away. Without the badge, the first sign of this would be the toast after the run has already ended (`Store.swift:101-107`).

## What closes the gate

All of these live in `budgetGate` in `cli/src/gate.ts`. Defaults come from `cli/src/config.ts:80-82`: `min5hLeftPct: 10`, `weeklyReservePct: 10`, `weeklyPace: true`. A reason closes the gate (the badge shows "Holding"). A note is extra information that doesn't close it, but it still shows in the tooltip.

### Reasons (badge shows "Holding")

| # | Text shown (from `gate.ts`) | Plain meaning | Source |
|---|---|---|---|
| 1 | `5h window unknown: no quota snapshot (set up \`chompyy statusline\`)` | Chompyy has never read your quota, so it can't tell how much is left. | `cli/src/gate.ts:51` |
| 2 | `5h window has reset and weekly usage is unknown, so the budget can't be checked` | The 5h window has reset, and there's also no weekly number to check against. | `cli/src/gate.ts:50` |
| 3 | `5h window is used up: running now would spill into paid extra usage` | 100% of the 5h window is used. This applies whatever your settings say. | `cli/src/gate.ts:56` |
| 4 | `5h window has N% left, under the 10% minimum` | Less than `min5hLeftPct` is left in the 5h window. | `cli/src/gate.ts:58` |
| 5 | `weekly limit is used up: running now would spill into paid extra usage` | 100% of the week is used. | `cli/src/gate.ts:65` |
| 6 | `weekly usage is N%, over the 90% hard stop` | You're over `100 - weeklyReservePct` for the week, whatever the pace. | `cli/src/gate.ts:67` |
| 7 | `ahead of pace this week: N% used, an even pace is M% by now` | Even pace means using the week evenly. For example, 2.5 days into a 7-day week, even pace is about 36%. If you've used more than that, Chompyy won't borrow from the days ahead. | `cli/src/gate.ts:72` |
| 8 | `weekly <Model> limit is used up: running now would spill into paid extra usage` | A model with its own weekly limit (for example Opus) is at 100%. | `cli/src/gate.ts:82` |
| 9 | `weekly <Model> usage is N%, over the 90% hard stop` | Same as #6, for one model's own weekly limit. It only closes the gate if away runs are set to that model (`runModel`). | `cli/src/gate.ts:84` |

### Notes (tooltip only, the gate stays open)

| Text shown | Source |
|---|---|
| `the 5-hour window has reset: this run starts a fresh one (100% left)` | `cli/src/gate.ts:46` |
| `weekly usage unknown; reserve not checked` | `cli/src/gate.ts:63` |
| `N% of the week unspent so far (N% used, even pace M%)` | `cli/src/gate.ts:74` |
| `weekly <Model> usage is N%; away runs use Claude Code's default model, which may be <Model>` | `cli/src/gate.ts:85` |

To check any row, search `cli/src/gate.ts` for the quoted text. The tests that pin these strings are in `cli/test/gate.test.ts`, `cli/test/safety.test.ts:19-21` and `cli/test/pacing.test.ts:137-142`.

**Which reason you'll see most often.** On a normal working day it's probably #7 (ahead of pace) or #4 (5h under 10%). That's because Chompyy is meant to spend only what you didn't use yourself. This is a guess from how the code works. I haven't measured how often each reason shows up.

## Do we need it?

Options:

- **A. Keep it as it is.** It costs nothing. But the question in this task shows the problem: it looks like a button, and the reason is hidden behind a hover.
- **B. Keep it, and make it tappable to show the reasons (recommended).** Clicking the pill opens a small popover listing `reasons` (and `notes` underneath in grey). A popover is a small panel attached to the thing you clicked. Optionally, show the first reason in short form under "Holding", e.g. "Holding · ahead of weekly pace".
- **C. Remove it.** The cookie and "This week" bar already show the raw numbers. But they don't combine them into a yes/no, and they don't cover the unknown-quota cases (#1, #2) or the per-model limits (#8, #9).

**Recommendation: B.** The badge answers the one question the header can't answer at a glance: "if I go to sleep now, will anything run?" Several things decide that answer (9 reasons, 3 settings, per-model limits), so you can't easily work it out from the bars. Removing it means you find out after the night is gone, from the toast at `Store.swift:101-107`. That runs against the "one bad card never eats the night" guardrail. The confusion comes from the pill looking clickable while doing nothing. Making the click open the reasons removes the confusion, and the gate already returns all the data (`gate.reasons`, `gate.notes`). So it would be a small Swift-only change, with no new CLI work.

What B would not fix: the strings are written for the log, so some are long. A short label per reason would need a small mapping, either in Swift or as a new field from the CLI.

## Open questions

1. **B with or without the inline short reason?** A popover alone is the smallest change. Adding the first reason inline ("Holding · ahead of pace") means you never need to click, but the header gets wider. It already sets `minWidth: 1080` (`Board.swift:50`).
2. **Should "Holding" be renamed?** For example "Away runs paused" or "Won't run now". "Holding" doesn't say what is being held. That would be a rename, which is out of scope here, so it's left for you to decide.
3. **Should the Away menu warn when the gate is closed?** Right now you can start an away run while the badge says "Holding", and it ends at once. The 5h-only case is the exception: there the run waits for the reset (`away.ts:210-225`). A one-line warning in the menu would make that clear.
4. **Not checked:** I didn't run the Mac app, so I haven't seen the tooltip delay or how the pill looks in the window. Everything above comes from reading the code at `e1a888c`.
