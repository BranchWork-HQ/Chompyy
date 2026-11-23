# Try Chompyy (early testers)

Thanks for trying it. Chompyy is in its first test version: it has rough edges, and your feedback decides what gets built next.

```
 1. install        2. park an idea        3. go away           4. come back
 npm + app   ──►   on a repo, read   ──►  "I'm away 30m"  ──►  review, keep or undo,
 (5 minutes)       its blueprint,         cards run while      rate it: what would have
                   approve it             you're gone          made it a 5?
```

## What you need

- A Mac on **macOS 14** or later (Apple Silicon or Intel)
- **[Claude Code](https://code.claude.com)**, logged in on a **Pro, Max or Ultra** plan, with `claude` working in Terminal
- **Node.js 20+**
- A git repo you don't mind a robot working in (Chompyy works on a copy, but start with something low-stakes)

Check the first two in Terminal before you start:

```bash
command -v claude && node -v    # want: a path, then v20 or higher
```

- **No `claude`?** The Claude desktop app doesn't add `claude` to Terminal, so desktop-app-only Macs need the command-line version too. Install it with `curl -fsSL https://claude.ai/install.sh | bash`, or `brew install --cask claude-code` (see [Claude Code's setup page](https://code.claude.com/docs/en/setup)), open a new Terminal window, run `claude` once and log in with the same account.
- **No `node`, or older than v20?** Get the LTS installer from [nodejs.org](https://nodejs.org), or `brew install node` if you use Homebrew.

## Install (about 5 minutes)

```bash
npm install -g chompyy
chompyy status      # first run: reads your quota
chompyy app         # downloads the Mac app to ~/Applications and opens it
```

On the first `chompyy status`, macOS asks whether `security` may use the **"Claude Code-credentials"** keychain item. Choose **Always Allow**. Chompyy uses Claude Code's own login only to ask Anthropic how much of your 5-hour and weekly limit is left; it never sends a message and never changes your limits. Choose Deny and Chompyy falls back to reading Claude Code's status line (see [cli/README.md](cli/README.md#set-up-the-quota-snapshot-fallback)).

A 🍪 appears in your menu bar. Click it, then **Open board**.

## Let it get to know you (1 minute)

The board starts with **Let Chompyy get to know you**. Press **Get started**: it shows what it reads from your Claude Code history (on your Mac, secrets removed; **See exactly what's sent** shows every word), then suggests how you like work done and a few tasks from things you said you'd do later. Tick what's right; nothing is added otherwise. Claude Code deletes sessions after 30 days, so **Keep a year of history** is worth pressing.

## Your first card (15 minutes, most of it away)

1. **+ Park an idea**, pick your repo, and write a small task you'd actually want done: *"Add a test for the date parser"*, *"Write a CONTRIBUTING guide from how this repo works"*, *"Make a quiz on chapter 3 of my notes"*.
2. Open the card. Chompyy drafts a **blueprint**: a picture of the goal, what changes, what it won't touch, and how it checks itself. Not right? **Edit** or **Redraw**. Happy? **Approve**.
3. **🌙 I'm away → Away for 30m**, and go do something else. The Mac stays awake while it works; keep it plugged in with the lid open.
4. Come back to the **Review** column. Read what it did, **See the change**, then **Keep** it (merged into your branch) or **Undo** it (thrown away).
5. **Rate it.** Pick what would have made it a 5. This is how Chompyy learns your taste, and it's the feedback I need most.

## Good to know

- **Your code is safe by default.** Each card runs in its own copy (`~/.chompyy/worktrees/<id>`, branch `chompyy/<id>`). Nothing reaches your branch until you press Keep.
- **It can't go outward.** Away runs are sandboxed: no push, no publish, no network from the shell, and no web tools (blueprints still search the web while you're there). The agent reads only its own folder and can't write your repo's `.git`; Chompyy makes the commit after it finishes. Set `"awayWeb": true` in config.json to give away runs web search back.
- **It only uses capacity you'd lose.** It waits for an active 5-hour window, stops when the window runs low, and never starts a new window just to draft.
- **Everything stays on your Mac** in `~/.chompyy/`. The only calls out are Claude Code itself and the quota check to Anthropic.

## Tell me how it went

The one question: **what would have made it a 5?**

- [Open a tester report](https://github.com/BranchWork-HQ/Chompyy/issues/new?template=tester-report.yml) (2 minutes), or just message me.
- Something broke? Paste the last lines of `~/.chompyy/app-away.log` and the card number.

## Update or uninstall

```bash
npm install -g chompyy@latest && chompyy app     # update both
```

Uninstall: in the menu bar's ⋯ menu turn off **Open Chompyy at login**, then **Quit Chompyy**, then

```bash
chompyy triggers off    # removes the LaunchAgent that starts away runs on its own (if you turned it on)
rm -rf ~/Applications/Chompyy.app
npm uninstall -g chompyy
rm -rf ~/.chompyy       # your board, ratings, logs and the cards' working copies (optional)
```

Cards leave a branch (`chompyy/<id>`) in each repo they worked in, and a worktree entry once `~/.chompyy` is gone. To clean a repo, in that repo:

```bash
git worktree prune                                   # forget working copies that no longer exist
git branch --list 'chompyy/*'                        # see the card branches first
git branch -D $(git branch --list 'chompyy/*' --format='%(refname:short)')
```

Kept cards are already merged into your branch, so deleting their `chompyy/<id>` branch loses nothing.
