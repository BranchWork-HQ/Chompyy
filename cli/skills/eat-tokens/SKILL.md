---
name: eat-tokens
description: Show how much of the Claude 5-hour window is left and which Chompyy cards fit in it. Use when the user types /eat-tokens or asks "what can I run with what's left?", "how much quota is left?", "anything to use my leftover tokens on?".
---

# /eat-tokens

Answer "what can I run with what's left?" from the Chompyy board. Read only: never send a message just to check quota, and don't start runs unless the user picks cards.

1. Run:

   ```bash
   chompyy eat-tokens
   ```

2. Read the numbers: % left in the 5h window, time to reset, pace per hour, weekly used. If the snapshot is stale or missing, say so plainly (the window has reset or the status line isn't set up) and stop there: there's no leftover to plan for.
3. Suggest which cards fit, in a short table: card, column, why it fits or doesn't. The command lists approved and later cards but doesn't estimate runtime; use the blueprint to judge scope and avoid pretending to know token cost. Prefer approved cards; mention later cards that need a blueprint and approval first. Leave room for the weekly reserve if weekly used is high.
4. Offer the next step in one line, for example: `chompyy approve 3 && chompyy away 1h`, or `/away 40m`. Run it only if the user says yes.
