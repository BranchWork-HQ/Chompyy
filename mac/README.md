# Chompyy for Mac

A menu bar cookie and a board window over the `chompyy` CLI. The app holds no logic: it reads `chompyy state --json` and runs `chompyy` commands.

```bash
cd cli && npm install && npm link   # once: the CLI the app talks to
chompyy status                      # once: records where the CLI lives (~/.chompyy/cli.json)
mac/Scripts/build-app.sh --open     # build mac/build/Chompyy.app and start it
```

- **Menu bar:** the cookie loses a bite for every ~1/8 of the 5-hour window used, with the percent left beside it like a battery ("73%", or "—" when unknown). Click it for what's left, the week against an even pace, and the cards waiting for you.
- **Board:** Suggested · Later · Approved · Running · Review · Done. Click a card to open it: the blueprint as a picture first (goal → changes → won't touch → done when), then Approve, Edit, Redraw, answer questions, See the change, Keep, Undo, rate.
- **Quota:** read live from Anthropic with Claude Code's saved login (macOS asks once to allow the Keychain item). No message is sent, so no window is started. At most one request per 5 minutes.

Testing switches: `CHOMPYY_HOME=<dir>` uses another state folder, `CHOMPYY_OPEN_BOARD=1` opens the board at launch, `CHOMPYY_SELECT=<id>` opens a card.

Structure follows codeburn's `mac/` (SwiftPM, no Xcode project), macOS 14+.
