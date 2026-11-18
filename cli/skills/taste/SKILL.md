---
name: taste
description: Show the user's Chompyy taste.md, what Chompyy has learned about how they like work done. Use when the user types /taste or asks "what have you learned about me?", "show my taste file".
---

# /taste

1. Run:

   ```bash
   chompyy taste
   ```

   It prints `~/.chompyy/taste.md`, creating a stub with a header the first time.
2. Show the content as is. If it's only the stub, say nothing is learned yet: preferences come from ratings, blueprint edits and keep/undo, and the distiller reads them after each away run (or now with `chompyy distill`).
   - To see every preference, including ones waiting to be asked: `chompyy taste list`.
   - "Why do you think that?": `chompyy taste why <id>` shows the cards, edits and quotes behind it.
   - The user answers a question with `chompyy taste yes|not-now|never <id>`, or stops one with `chompyy taste retire <id>`.
3. If the user wants to change something, edit `~/.chompyy/taste.md` directly. The user's edits always win; keep each line short and under a `## <scope>` heading.
