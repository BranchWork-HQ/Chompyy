# Chompyy Mac app: UI/UX ideas (2026-11-21)

**Summary:** most fixes are small. The biggest wins are making the "you choose" promise true in first run, showing a run's result before its plan, and asking one thing at a time.

I read `mac/Sources/Chompyy/` (Board, CardDetail, Picture, Feedback, ColdStart, Cookie) and checked it against two rules in FEATURES.md: **picture first** (line 44) and **warm, not noisy** (lines 253-260: "One question per report, at most", "Never interrupt"). No code was changed and nothing was run in the app. Every claim below quotes a line of code; none was checked by clicking through the real app.

Effort: **S** = under an hour, one file. **M** = half a day, or a new small view. **L** = needs CLI changes too.

## Ranked list

| # | Area | Idea | File:line | Effort |
|---|---|---|---|---|
| 1 | First run | Start cold-start picks unticked, so "you choose" is true | `ColdStart.swift:356` | S |
| 2 | Card sheet | On a card waiting for review, show the result before the plan picture | `CardDetail.swift:24` | S |
| 3 | Report and rating | Ask for stars only after Keep or Undo, not at the same time | `CardDetail.swift:29` | S |
| 4 | Report and rating | Show one waiting rule at a time, with "+N more" | `Feedback.swift:48` | S |
| 5 | Card sheet | Ask before "Run again", like Undo already does | `CardDetail.swift:232` | S |
| 6 | Board | Say why it's "Holding" next to the badge, not only in a tooltip | `Board.swift:165` | S |
| 7 | First run | Let "Not now" hide the cold-start banner | `ColdStart.swift:180` | S |
| 8 | Card sheet | A small picture of the result (what changed, what was checked) | `CardDetail.swift:192` | M |
| 9 | Board | Fold empty columns into thin strips | `Board.swift:195` | S |
| 10 | Board | Trim the toolbar from six buttons to four | `Board.swift:36` | S |

## Why, by area

### Board

**6. Say why it's "Holding".** The badge shows only one word; the reason sits in a hover tooltip:
`Label(gate.ok ? "Ready to run" : "Holding", ...)` (`Board.swift:165`) and `.help((gate.reasons + gate.notes).joined(separator: "\n"))` (`Board.swift:171`).
If you see "Holding" and don't know to hover over it, you can't tell why your approved cards won't run. Change: put the first reason in small text under the badge, for example "Holding: this week is 12% fast". Keep the full list in the tooltip.

**9. Fold empty columns.** All six columns are always shown at full width, `ForEach(Column.allCases) { column in ColumnView(column: column) }` (`Board.swift:20-21`), and folding is allowed only for Done: `private var canFold: Bool { column == .done }` (`Board.swift:195`). An empty column still draws a dashed "Nothing here" box (`Board.swift:247-252`). On a new board that means up to six "Nothing here" boxes, which is noise. Change: draw an empty column as the thin strip that already exists (`strip(_:)`, `Board.swift:277`) and open it again when a card arrives. The column's own count badge already turns orange when a card needs you (`Board.swift:297-303`), so nothing gets hidden.

**10. Trim the toolbar.** The toolbar has six controls: Park an idea, Usage, Suggest from my history, What Chompyy heard from you, I'm away, Refresh (`Board.swift:33-58`). "Suggest from my history" (`Board.swift:36`) opens the same sheet as the cold-start banner's button (`ColdStart.swift:55`). Change: move "Suggest from my history" and "Refresh" into a "More" (`…`) menu. That leaves the four things you use every day.

### Card sheet

**2. Result before the plan picture.** The sheet always draws the plan picture first: `if card.blueprint != nil && !editing { picture }`, then `if card.needsYou { reviewSection }` (`CardDetail.swift:24-25`). The picture can be up to 900 points tall: `min(h, 900)` (`Picture.swift:85`). So when a card says "It's done. Check it, then keep or undo" (`CardDetail.swift:154`), the result and the Keep button can sit below a full screen of plan. Change: when `card.needsYou`, show `reviewSection` first and move the plan picture into the "Details" fold, the way `BlueprintMap` already moves there once a picture exists (`CardDetail.swift:336-340`).

**5. Ask before "Run again".** Undo asks first: `.confirmationDialog("Throw this run away?", ...)` (`CardDetail.swift:237`). "Run again" also throws the work away, as its own tooltip says, `"Throw this attempt away and run it again from your latest code"` (`CardDetail.swift:235`), but it runs on the first click (`CardDetail.swift:232-234`). Two buttons that both throw work away should both ask first. Change: add the same kind of dialog ("Throw this attempt away and run again?").

**8. A picture of the result.** Picture first currently covers only the plan. The result is plain text: `Text(md(run.summary))` in a grey box (`CardDetail.swift:193`), then a file list (`CardDetail.swift:249-258`). FEATURES.md:178 marks reports as not built yet: "blueprints ✅ (2026-11-17), reports 📋". Change: a small native 4-box map like `BlueprintMap`, with the boxes "Goal → What changed (N files) → Checked (Chompyy's result) → Your call (Keep / Undo)". It uses data the card already has (`card.files`, `card.run?.verified`), so it needs no model call and costs no tokens. The richer diagram-design drawing can come later.

### Report and rating

**3. Stars only after Keep or Undo.** The rating section shows on cards that still need a decision: `if card.column == "review" || card.column == "done" { ratingSection }` (`CardDetail.swift:29`). A review card therefore asks two things at once: keep or undo, and how many stars. That breaks "One question per report, at most" (FEATURES.md:256). Change: show the rating only when `card.outcome != nil`, which means after Keep or Undo. Keeping a card moves it to Done (`to: .done`, `CardDetail.swift:227`), so the rating then shows up there.

**4. One waiting rule at a time.** The feedback sheet lists every waiting rule at once: `ForEach(waiting) { TasteRow(item: $0, waiting: true) }` (`Feedback.swift:48`). Each rule has its own Yes / Not now / Never buttons (`Feedback.swift:222-225`). With 6 rules ready (the first real nightly read made 6 that were "ready to ask", FEATURES.md, nightly read row), you get 18 buttons in one view. Change: show the strongest rule, plus a "+5 more" link that opens the rest. The rule "One question per report... the strongest evidence goes first" already says this.

### First run

**1. Start the picks unticked.** The notice promises `"You choose", "nothing added until you tick it"` (`ColdStart.swift:137`). But when the results arrive, every item is already ticked: `pickedTaste = Set(cs.taste.filter { $0.status == "proposed" }.map(\.id))` and the same for cards (`ColdStart.swift:356-357`). The add button is also the Return-key default, `.keyboardShortcut(.defaultAction)` (`ColdStart.swift:253`), so one press of Return adds everything. Change: start both sets empty. Or, if you'd rather keep the pre-ticks, change the promise to "untick anything that's wrong". I recommend starting empty, because this is the first moment where you decide whether to trust Chompyy.

**7. Let "Not now" hide the banner.** The banner shows until the cold start is done: `if let cs = store.state?.coldStart, cs.status != "done"` (`ColdStart.swift:43`). "Not now" only closes the sheet: `Button("Not now") { dismiss() }` (`ColdStart.swift:180`). So after you say "not now", the banner stays on the board every day. Change: "Not now" saves a date (for example with `@AppStorage`) and hides the banner for 7 days. The toolbar or `…` menu entry still opens the sheet any time.

## Keep (these already work, don't lose them)

- **Chompyy's check comes before the agent's claim.** "Chompyy's measurement leads; the agent's own words are a claim, shown under it" (`CardDetail.swift:161`), with `Text("It said: \(checks.why)")` in smaller grey text (`CardDetail.swift:172`). The board tile follows the same order (`Board.swift:380-384`). This is the "measured, not claimed" taste, and it shows on screen.
- **Receipts and three ways to answer on every rule.** `Button(showReceipts ? "Hide receipts" : "Receipts: \(item.evidence)")` (`Feedback.swift:204`) and Yes / Not now / Never (`Feedback.swift:222-225`). Retire keeps the reason: "It's kept with the reason, never silently deleted" (`Feedback.swift:228`).
- **A picture even before the diagram is drawn.** "Until the picture is drawn, the blueprint at a glance stands in for it" (`CardDetail.swift:333`), so a card never opens as a wall of text. The cold-start notice is a 4-step picture too (`ColdStart.swift:131-137`), with "See exactly what's sent" (`ColdStart.swift:152`).
