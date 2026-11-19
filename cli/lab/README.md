# The lab

Tools for building Chompyy itself, not features for users. Nothing here is in the npm package or the app.

## `npm run lab`: a fake night

`night.lab.ts` runs a whole away night against a throwaway repo, with the real CLI and a fake agent
(`fake-claude.mjs`, which spends no tokens). Run it before a real night, and after any change to away runs.

What it proves, in order:
1. `chompyy preflight` finds the repo's check and proves it passes in the away box.
2. `chompyy away` takes 4 approved cards through fresh base → run → Chompyy's own check → review, with
   exact tokens recorded; every card starts from the latest main.
3. Chompyy's own check catches the card that breaks the test, although the agent said "passed".
4. Keeping one card makes another clash; Chompyy refreshes it by itself, checks it, and it keeps cleanly.
5. Keep on a clashing card keeps it by itself once it's refreshed.
6. Undo leaves main alone.

`LAB_KEEP=1 npm run lab` keeps the lab folder (repo, `~/.chompyy`-style home, logs) to look at afterwards.

Every bug the lab finds becomes a step here. The first one (2026-11-20): cards started from the remote's
main even when your local main had kept cards not pushed yet.
