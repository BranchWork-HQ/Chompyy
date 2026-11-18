# Away readiness: same results as prompting Claude directly, in a safe box

Status: agreed with the user on 2026-11-18. Step 1 done (`chompyy preflight`); steps 2–6 next. Build against this; don't patch around it.

## Why

On 2026-11-18 almost every away card reported "checks fail", and almost none of it was the agents' work:
cards ran on a checkout 30 commits behind main, `npm ci` hammered an offline sandbox, two tests write to `$HOME`
(which the box forbids), and `swift build` can't run inside the box at all. Each was fixed as it appeared;
the user asked for a system instead: "rn it feels like we are just patching things up".

An away agent and an interactive Claude Code session are the same program started differently. The
differences that keep the night safe stay: no one to approve at 3 AM, nothing outward (push, publish, curl),
no credentials, no shell network for the agent. The differences that change **results** must go: old code,
missing dependencies, and checks that can't pass in the box.

## The model

```
 ONCE PER REPO (and when main changes)              EVERY CARD
 1 PROFILE    how to install / build / test         4 FRESH BASE  copy of the latest main
 2 PREFLIGHT  run the profile on clean main,        5 SETUP       deps cloned copy-on-write (instant);
              in the box AND outside it                           install once, with network, only if
              pass in box      → ready                            the lockfile changed
              fail only in box → box problem        6 AGENT       offline box, with exactly the
              fail everywhere  → main is broken                   permissions you ticked
 3 CATALOG    known box failures: signature →       7 VERIFY      Chompyy runs the checks on main and
              cause → fix (auto, permission, repo)                on the card → reports NEW failures only
                                                    8 SELF-TEST   sample repos through the whole pipeline
 APPROVAL STAGE: the blueprint (drafted with web search) carries a permission plan built from preflight,
 e.g. ☑ swift build outside the box ☐ network to registry.npmjs.org. Ticked when you approve. A need nobody
 predicted is recorded and offered as a checkbox next time.
```

### Rules
- **Differential, not guessed.** A check failing in the box is only called a box problem if the same check
  passes outside it on the same code. The catalog explains *which* box problem; it never decides alone.
- **Every new failure becomes a catalog entry and a regression scenario**, never a one-off patch.
- **Never reinstall per card.** Clone installed dependencies (APFS `cp -c`); install only on lockfile change.
- **Same code as interactive Claude:** the latest main, fetched by Chompyy (outside the box) before the run.
- **Outside-the-box runs are your own code on main** (preflight), or need a ticked permission (cards).

## Steps (one PR each, tested before the next)
1. Profile + preflight + failure catalog (`chompyy preflight`).
2. Fresh base + setup stage (latest main; clone deps; install on lockfile change).
3. Permission plan on blueprints (from preflight) + research in drafting.
4. Verify main vs card (new failures only).
5. Self-test harness: sample Node / Swift / Go repos and every incident as a scenario.
6. App: away-ready status per repo; honest check results and the permission plan on cards.

## Step 1 result (2026-11-18)
`chompyy preflight` on this repo's main found, in 87 s and without running a card: `npm test` fails only in the
box (two tests write to `$HOME`), `swift build` fails only in the box (SwiftPM nests a sandbox and caches in
`~/Library`). Fixed through the system: the tests now use temp folders (and the sandbox test skips where
sandboxes can't nest), and Swift runs as `swift build --disable-sandbox` with caches in the box. Result:
**away-ready: yes**, and the agent's prompt now lists those proven commands.

## Prior art
- OpenAI Codex cloud: a setup script runs with internet, then the agent works with internet off.
- Cursor background agents: a per-repo environment file with install and start commands.
- Chompyy's own independent check (`cli/src/verify.ts`): the sandbox profile preflight reuses.
