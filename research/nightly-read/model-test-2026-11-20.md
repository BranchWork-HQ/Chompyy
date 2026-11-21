# Nightly read: which model? (test run 2026-11-20)

**Question:** does a bigger model find better taste rules in a night of stripped sessions?

## How the experiment was set up

**The data.** Six days of the user's own Claude Code sessions, 2026-11-14 to 11-19, read from `~/.claude/projects/*/*.jsonl` on their Mac.
- **Coding folders only:** a session counts if the folder it *started* in is a git repo. Sessions from the Claude desktop app are left out. (A first version dropped whole sessions whenever Claude `cd`'d into a temp folder mid-session; fixed by deciding once, from the starting folder.)
- **Stripped** with `strip-sessions.py`: kept what the user typed, Claude's written replies, a one-line note per tool call (`[Edit: cli/src/away.ts]`), and ⚑ marks for rejected tool uses and interruptions. Dropped tool output, file contents and diffs.
- Size after the strip: 14k · 9k · 8k · 41k · 42k · 10k tokens (from 0.6–9.9M raw).

**The models.** Haiku, Sonnet and Opus (Claude 5.5 family), each through `claude -p --model <m>` on the user's subscription. Fable 5.1 / 5.2 answered "requires usage credits" on this plan, so it was left out rather than spend money unasked.

**Isolation, so nothing else steered the models:** `--tools ""` (no tools: it can only read what it's given), `--strict-mcp-config` (no MCP servers), `--setting-sources ""` (no CLAUDE.md, no user settings or memory), `--no-session-persistence` (the test's own runs don't end up in the logs it reads), run from `/private/tmp`.

**One call per model per day:** `reader-prompt.md` followed by that day's stripped log. 3 models × 6 days = 18 calls, run with `run.sh`. Same prompt, same input, no retries, no cherry-picking: each model's first answer is the one scored.

**The prompt asked**, for each Claude reply and the user's next turn: accepted, redirected or rejected, and what lasting way of working does that show? It must skip one-off task instructions, project facts and anything personal, and every rule must quote the user's exact words. Output: a JSON list of {rule, why, quotes, strength: stated/implied}.

## How it was scored

1. **Real quotes (automatic, `score.py`).** Each quote is checked word for word (ignoring spacing and case) against what the user typed that day, only their own turns, never Claude's. A first version only looked at the first line of each multi-line message and reported 36–43% matches; after the fix every quote matched.
2. **Answer key (by hand).** The models never saw it. It's five rules the user confirmed in these same days, which the assistant had already saved in its memory folder before the test: build systems not patches · ask "what would have made it a 5" · show a picture first · the cookie look (bites only, googly dots) · plain, simple words. A rule counts as found when one of the model's rules says the same thing, on any day; "vaguely" means it pointed in the direction without the specifics.
3. **Unique insights (by hand).** Rules that are true of the user, specific to them, and not already in memory. Judged by the assistant from the sessions; the user is the final judge.
4. **Cost:** tokens in and out and wall time, from each call's own usage report.

**Limits of this test:** one user, six days, one run per model (no repeats, so luck isn't measured). The answer key is small (5 rules), and the by-hand judgments were made by the assistant, not blind. The rule counts include the same rule repeated on different days.

## Results

| | Haiku | Sonnet | Opus |
|---|---|---|---|
| Rules proposed (6 days) | 41 | 44 | 46 |
| Quotes that match the user's words exactly | 55/55 | 70/70 | 69/69 |
| Days read | 5 of 6 (returned nothing for 11-14) | 6 | 6 |
| Answer key found (of 5) | 4, cookie look only vaguely ("playful") | 4, cookie look vaguely | 4, cookie look vaguely ("expressive faces") |
| Tokens in / out (6 days) | 225k / 14k | 221k / 11k | 221k / 13k |
| Time (6 days) | 66 s | 88 s | 131 s |

**What separated them** was not the answer key but the *unique* insights, the ones nobody wrote down before:
- **Opus:** "the user answers by quoting each line back and responding to it individually, so structure replies as numbered points"; "when using made-up inputs for a test, say so up front"; "when a step needs the user's own login, switch to short copy-paste instructions"; "make every automated action easy to roll back".
- **Sonnet:** "never cut user-facing text off mid-sentence"; "answer each point of a tangled message under its own heading"; "proactive features should be quiet: warmth, not noise".
- **Haiku:** mostly sound but more generic, and it missed a whole day.

**Also learned:**
- Every model found "study prior art first" too (said in other words, so the keyword check had missed it).
- None caught the specific cookie look; the reader prompt tells it to skip "facts about the project", which may push product taste out. Worth a prompt change: product look and feel *is* taste.
- About 45 rules for 6 days is too many to show. Many are the same rule on different days, which is exactly the "second sighting" that should promote a candidate. Merging plus two sightings would cut this to a short list.
- The first quote check was wrong (it only looked at the first line of a multi-line message); fixed in `score.py`.

## Take

Use **Opus** for the nightly read. It costs the same tokens as the others (the input dominates), it's slower but nobody waits at night, and it found the most specific, unique rules. Sonnet is a close second and the fallback when the window is tight. Not Haiku: it skipped a whole day.
