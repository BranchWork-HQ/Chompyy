---
name: away
description: Run approved Chompyy cards headless while the user steps away, using quota that would otherwise reset. Use when the user types /away <duration> or says "I'm stepping out for an hour, run the queue", "run my cards while I'm away".
---

# /away

Start a Chompyy away run for the duration in `$ARGUMENTS` (for example `1h`, `30m`, `1h30m`).

1. If no duration was given, ask for one and stop.
2. Show the plan first, without starting anything:

   ```bash
   chompyy away <duration> --dry-run
   ```

   If the gate is closed (little left in the 5h window, weekly reserve reached, or no fresh snapshot), report why and stop. Don't pass `--force` unless the user asks for it by name.
3. Start the real run in the background so it survives this session, and tell the user where the output goes:

   ```bash
   nohup chompyy away <duration> > ~/.chompyy/away.log 2>&1 &
   ```

4. Reply in two lines: which cards will run, and that `chompyy report` shows the results when they're back.

The run is safe by design: each card works in its own git worktree (branch `chompyy/<id>`) or a draft folder, with no push, merge, PR, sending or posting. Don't change that.
