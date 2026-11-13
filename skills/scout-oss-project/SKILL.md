---
name: scout-oss-project
description: Profile an open-source project (popularity, growth, age, angle, features, evidence) or survey a whole theme of them, as a row others can compare. Use when someone shares a repo link and asks "what is this / is it worth a look / how does it compare", or asks to find the projects around an idea ("what's out there for token saving").
---

# Scout an open-source project

Output is one **profile** per project, in the shape below, so profiles from different days and agents line up in one table. Facts come from the API or the repo; anything else is labelled as the project's claim or your read.

## 1. Numbers (from the API, never from the README)

```bash
python3 tools/repo_stats.py owner/name >> data/snapshots/$(date +%F).jsonl
python3 tools/repo_stats.py --table < data/snapshots/$(date +%F).jsonl
```

| Field | Meaning | Watch out |
|---|---|---|
| Stars, forks | popularity today | a README can quote old or inflated numbers; use the API |
| Created, age | when it started | a renamed or moved repo keeps its old date |
| ⭐/day lifetime | average pull since day one | |
| ⭐/day now | stars in the recent events window | a hot repo's window is hours, not a month: say "right now" |
| Momentum | now ÷ lifetime: > 1 accelerating, < 0.3 cooling | a launch spike makes every later week look cool |
| Last push, releases | is it alive | |
| Licence | can we reuse code | AGPL, "other" or none: ideas only, no code |

Growth over a period: diff two snapshots of the same repo. For the curve, link `https://star-history.com/#owner/name`. GitHub no longer serves stargazer timestamps (2026-11), so don't try that route.

## 2. Read (README, then docs/ and a release note)

Answer each in one or two lines:

1. **Angle**: which part of the problem it attacks, in our taxonomy if the theme has one (for token saving: [`research/landscape-2026-11.md`](../../research/landscape-2026-11.md) §Angles).
2. **How it hooks in**: skill/prompt, plugin/hooks, MCP server, local proxy, CLI wrapper, library, own agent, app.
3. **Features**: the 3–6 that matter, not the whole list.
4. **Claim**: the headline number and **what it divides by** (one shell command's output? one reply's prose? the whole bill?). This is the most common way a 90 % becomes 3 %.
5. **Evidence**: vendor-run, paper, or independent. Search `"<name>" benchmark OR tested OR "A/B"` once; name the best independent result, or write "none found".
6. **Compares itself to**: the competitors it names. Feed new names back into discovery.

## 3. Profile

```markdown
### owner/name — one-line angle
⭐ 12,345 · created 2026-03-01 (250 d) · ⭐/day 49 lifetime, 12 now (0.24×, cooling) · last push 2026-11-07 · MIT
- Hooks in: plugin + hooks (Claude Code, Codex)
- Does: …; …; …
- Claims: "60–90 % fewer tokens" — of shell output only, chars÷4
- Evidence: independent A/B (JetBrains, 2026-07): +7.6 % cost at low effort
- Names as rivals: headroom, caveman
- For us: reuse / learn from / ignore, and why
```

## Surveying a theme

Finding *enough* projects is the hard part. Run [`tools/discover.sh`](../../tools/discover.sh) (keywords + topics + named lookups), screen the list by hand, profile the survivors, then **snowball**: every README's "vs X" / "why not X" section and every awesome-list names projects the search missed. Add those names to the script and rerun until a round adds nothing. Also check, once per survey: Hacker News (`hn.algolia.com`, last 90 days), GitHub Trending, the theme's awesome-lists, and a web search for comparison posts (`"<theme>" tested`, `"<top tool>" vs`).

Search alone is not enough: on 2026-11-08 the largest project in the token-saving theme (ponytail, 186k ⭐) matched none of 20 keyword and 11 topic searches, because it pitches itself as "write less code". A comparison article named it.
