# 2026-11-17: an 8-hour away stopped on the first card

## What the user saw

Approved 11 cards before bed and started "Away for 8h" from the app. In the morning card #10 still said
**Running**, nothing was in Review, and the other 10 cards were still in Approved.

## What happened

- 23:13 the away run started card #10 in its worktree. The agent did real work (commit `eeac628`).
- 23:22 Chompyy's own Node process died: `FATAL ERROR: Reached heap limit … JavaScript heap out of memory`
  (`~/.chompyy/app-away.log`). It had used 4 GB.
- The agent's context was fine. This was **not** a context overflow: Claude Code manages its own context.
  What overflowed was Chompyy's memory of the agent's output.
- Nothing moved #10 out of Running, so the board showed a dead run as working all night.

## Why

1. **Unbounded buffering.** For the loop breaker the runner reads `--output-format stream-json --verbose`,
   which carries every tool result (whole file reads, build logs). It kept *every* event in memory and
   re-split its growing buffer on every chunk.
2. **The guardrails lived inside the thing they guarded.** The 30-minute card cap and the loop breaker both ran
   in the process that crashed, so they died with it. One card took down the whole queue.
3. **No one cleaned up.** A card in `running` was only recovered at the start of the *next* away.

## What changed (2026-11-18)

| Guardrail | What it stops | Result |
|---|---|---|
| Bounded memory | one chatty agent filling Chompyy's memory | lines over 4 MB skipped, only the final text kept, stderr/text capped |
| Raw stream on disk (`runs/<id>/<stamp>.stream.jsonl`, 50 MB cap) | not knowing what a run did | the full trail is on disk instead of in memory |
| Worker per card (`chompyy run-card`) | a crash in one card ending the night | the card goes to Review as `error`, its orphaned agent is stopped, the next card runs |
| Supervisor watchdog | a worker that hangs | killed after card cap + check time + 5 min |
| No-progress stop (`idleTimeoutMin`, 15) | an agent or command that hangs silently | the card stops as ⛔ stuck and the next one runs |
| 30-minute cap (`cardTimeoutMin`) | a card that runs too long | already there |
| Loop breaker (`loopRepeat`) | the same call repeated | already there |
| Orphan cleanup in `chompyy state` | a dead run shown as Running | the card moves to Review as soon as the app refreshes |

Tests: `cli/test/runner.test.ts` (a fake agent sending 240 MB fails on the old runner, passes now; silent agent
is stopped), `cli/test/away.test.ts` "guardrails: one bad card never eats the night". End to end: a fake agent
that `kill -9`s its own worker → card in Review as error, no orphaned agent, next card ran.

Why not compress the output in memory? It only delays the same crash (4 GB compresses to maybe 400 MB, and the next
run is bigger). The technique is: keep little in memory, spill the rest to disk with a cap.

## Rule to keep

A guardrail must live outside the thing it guards. Anything that watches a card runs in the supervisor, not
in the card's process.
