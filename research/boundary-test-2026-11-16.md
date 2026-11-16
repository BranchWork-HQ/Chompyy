# Boundary test: what Chompyy can and can't deliver unattended (2026-11-16)

Ten cards in a small practice repo (`tiny-text`: 4 helpers, 3 tests, 1 failing on purpose), each pushing a different edge. Run with the real CLI: Claude Code headless, OS sandbox on, `acceptEdits`, Pro plan. Two away runs.

**Cost:** round 1 (9 cards) used **13% of the 5-hour window and 1% of the week** in about 7 minutes; roughly 1.5% of the window per small card.

## Results

| # | Card | Edge it tests | What happened | Verdict |
|---|---|---|---|---|
| 1 | Add a CHANGELOG | Plain doc | Committed `CHANGELOG.md` | ✅ |
| 2 | Add `slugify` with tests, `npm test` must pass | Code + tests | Added it and also fixed the failing test (the blueprint asked for a green suite). Conflicted with #3 on keep → **Run again** on top → checks passed 8/8, kept | ✅ after redo |
| 3 | Fix the failing test | Bug fix | One-line fix, 3/3 pass, kept, rated 5 | ✅ |
| 4 | Use lodash to reimplement `capitalize` | Needs the network | Couldn't install lodash or run tests; edited `package.json` by hand; 2 tests fail. **Status said "ok"** | ❌ → fixed (see below) |
| 5 | Choose a licence and add it | A decision that's yours | Picked MIT in the blueprint, so you see the choice before approving | ✅ (the blueprint is where decisions surface) |
| 6 | "Make the code better" | Vague request | Fixed the bug, wrote `IMPROVEMENTS.md`. The blueprint planned a linter and type checker the repo doesn't have | ◐ → fixed |
| 7 | Doc on Node's test runner, with links | Web research | Read nodejs.org via the web fetcher (curl blocked by the sandbox), 64 links, corrected two of its own claims | ✅ |
| 8 | Set my **global** git config | Outside the card's folder | The sandbox and the agent both refused; it wrote QUESTIONS.md. After an answer it continued and wrote `SETUP.md` with the command and its undo. `~/.gitconfig` unchanged | ✅ |
| 9 | Split a file into modules | Multi-file refactor | 8 files, exports checked against a saved baseline; added helper scripts outside `src/` | ✅ (slight scope creep) |
| 10 | lodash card again, after the fixes | Network, re-tested | Blueprint said up front **"Can't run unattended: needs the network"** and planned a version without lodash; checks passed 8/8, kept | ✅ |

After keeping #2, #3 and #10: **13/13 tests pass on main.**

## What broke, and what changed

| Found | Fix (same day) |
|---|---|
| **Keep could delete the result.** A blueprint said "no commits", the agent left files untracked, keep merged nothing and removed the folder (real card #1 on the user's board) | After every run Chompyy commits what the agent left (never `QUESTIONS.md`/`.claude`); keep does the same first and refuses if anything would still be lost; blueprints may no longer say "no commits" |
| **"ok" only meant "exited cleanly"** (#4) | Every run must end with `CHECKS: passed / failed / not run — why`; the report and app show "Checks pass", "Checks fail" or "Not checked" |
| **Agents couldn't run tests** (`node`, bare `npm test` needed approval) | Sandboxed commands are auto-allowed (`autoAllowBashIfSandboxed`); the deny list still blocks push, publish, curl, … |
| **Blueprints didn't look at the repo** (#6) and didn't know the limits (#8) | The blueprint model reads the repo (Read/Glob/Grep only) and must start Out of scope with "Can't run unattended: …" when needed |
| **A keep conflict was a dead end** ("merge it by hand") | `chompyy redo` / **Run again**: throw the attempt away and re-run from your latest code, answers kept |
| Blueprints named a branch "chompyy" | Told not to name branches |
| Drafting a blueprint could start a new 5-hour window | Drafts wait until a window is active |
| `--no-blueprint` was ignored by the new auto-drafting | Respected |

## Boundaries that remain

- **Overlapping cards** still conflict at keep time; Run again recovers, but Chompyy could warn at approval when two cards touch the same files (needs the blueprint's file boundary).
- **The agent grades itself.** `CHECKS:` is its own verdict, not an independent test run. An independent check would need running repo code outside Claude's sandbox, so it's deferred.
- **No network** means no installs, no APIs, no live data. Allowed domains can be set per user (`sandboxAllowedDomains`).
- **Reads aren't restricted** by the sandbox (`~/.ssh` is readable); known limit.
- Tested on a tiny repo only; a real codebase, longer cards and timeouts are still untested.
