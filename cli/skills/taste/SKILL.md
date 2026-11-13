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
2. Show the content as is. If it's only the stub, say that preferences aren't distilled yet: ratings from `chompyy rate` collect in `~/.chompyy/signals.jsonl` until the distiller exists.
3. If the user wants to change something, edit `~/.chompyy/taste.md` directly. The user's edits always win; keep each line short and under a `## <scope>` heading.
