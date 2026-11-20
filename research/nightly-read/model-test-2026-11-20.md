# Nightly read: which model? (test run 2026-11-20)

**Question:** does a bigger model find better taste rules in a night of stripped sessions?

**Setup:** six days of the user's own coding sessions (2026-11-14 to 11-19). Coding folders only: terminal sessions that started in a git repo; desktop-app chats left out. Stripped with `strip-sessions.py` (what you typed, Claude's replies, a one-line note per tool call, ⚑ for rejected tool uses and interruptions). Each day was read by each model with `reader-prompt.md`, one `claude -p` call per day on the subscription (`run.sh`), and scored with `score.py`. Fable needs paid usage credits on this plan, so it wasn't tested. Raw logs and rules with quotes stay on the Mac; they're the user's own words.

**Answer key:** five rules the user confirmed in these same days (from the assistant's memory): build systems not patches · ask "what would have made it a 5" · show a picture first · the cookie look (bites only, googly dots) · plain, simple words.

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
