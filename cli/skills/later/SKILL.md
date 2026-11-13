---
name: later
description: Park an idea on the Chompyy board without switching tasks, so it can run later on leftover quota. Use when the user types /later <idea>, or says "do that later", "park this", "add to later".
---

# /later

Park the idea in the user's arguments as a Chompyy card. Don't start working on it.

1. Take the idea from the arguments: `$ARGUMENTS`. If it's empty, use the idea the user just mentioned in the conversation, written as one self-contained sentence (someone reading it tomorrow, without this chat, must understand it). If there's no idea at all, ask for one and stop.
2. Run it from the directory the idea is about (normally the current one), so the card remembers that repo:

   ```bash
   chompyy later "<idea>"
   ```

   Quote the idea safely for the shell. The blueprint is drafted in the background with a cheap model.
3. Reply in one or two lines: the card number, and that `chompyy show <id>` shows the blueprint and `chompyy approve <id>` queues it for `/away`. Then go back to what the user was doing.

If `chompyy` isn't found, say so and point to `cli/README.md` in the Chompyy repo for install.
