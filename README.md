# token-saving-research

> **It learns your taste, suggests the tasks you'd want done, and runs them while you're away, so tokens that would reset unused become work waiting for you when you're back.**

Research spun out of [BranchWork](https://github.com/BranchWork-HQ/branchwork): how to get more done per token with coding agents such as Claude Code. It covers what exists, what actually works when measured, and where there's room left.

> **Status: research stage.** Nothing to install yet. The direction below is a plan, not a product.

## Why

In [branchwork#107](https://github.com/BranchWork-HQ/branchwork/pull/107), a lean harness running a cheap model matched Opus on Aider Polyglot (34/34) at 1/39 of the cost. About 80% of plain Claude Code's cost there was the cache write at startup. So the harness matters more than the model, and most of the bill sits where few tools look.

## Where this is going

**The goal isn't fewer tokens. It's more finished work per weekly allowance, with less back-and-forth.** Heavy users get more out of the allowance they have; light users stop losing what resets unused.

The first product is **Chompyy**, focused on token *utilization*: using capacity in the 5-hour window that would otherwise reset unused. Like codeburn, it's a standalone local app (TypeScript CLI plus a macOS menu bar app) that works with the agents you already have, borrowing from codeburn and Orca (both MIT). Full design: **[research/spec-token-utilization.md](research/spec-token-utilization.md)**. The pieces BranchWork doesn't have yet get merged back there.

```
 day      /later <idea> → blueprint drafted in the background → card parked
    │     /eat-tokens → "what can I run with what's left?"
 away     /away 1h, bedtime, or the last hour before a reset
    │     → approved cards run headless on the leftover window
 back     "While you were away": what ran, rate it against its blueprint
    │
 night    ratings and corrections are distilled into taste.md you can read and edit
```

| Principle | Why | Evidence |
|---|---|---|
| **Accepted results, not burned tokens** | Background work nobody wanted turns free tokens into wasted review time | [spec §2](research/spec-token-utilization.md#2-what-success-means) |
| **Blueprint before every run** | Vague requests cause reruns; the blueprint is the goal, the boundary and the basis for the rating | [spec §5.4](research/spec-token-utilization.md#54-blueprint-before-every-run) |
| **A policy, not a stack** | Stacking token tools doesn't add up: they shrink the same tokens and break the prompt cache | [feature convergence](research/feature-convergence.md), [atomic knowledge §H](research/atomic-knowledge.md#h-combining-levers-the-angle-you-asked-about) |
| **Never break the cache** | Deleting or rewriting history cost more than it saved once priced with cache rates | [C2](research/atomic-knowledge.md#c-compression-what-survives-contact-with-agents) |
| **Learn only from approved work** | Skills distilled from verified runs help; skills learned without rules hurt | [G4, G5](research/atomic-knowledge.md#g-memory-and-skills-your-skill-distillation-idea) |
| **Taste on, event memory opt-in** | Your style helps every task; recalling your past in an unrelated chat doesn't | [C3](research/atomic-knowledge.md#c-compression-what-survives-contact-with-agents) |

## Scope

Token saving only, in every direction. Utilization comes first; the rest follow:

- **Window planning (first, Chompyy)**: queue tasks that are safe to run unattended, so subscription quota windows don't reset unused while you're away
- **Skill distillation**: turn verified successful runs into short skills that cheaper models can follow
- **Cache cost**: keep the prompt prefix stable and cheap to write, and don't break it
- **Routing**: send each task to the cheapest model that can do it
- **Convergence**: combine what the popular tools (rtk, headroom, caveman, ponytail, token-optimizer, codeburn) do well, as a measured policy per task type rather than a stack

## Rules

- Claims are measured: priced at real cache rates, with pass rate alongside cost
- Every finding cites a source: a paper, a provider doc, or a run
- Stays within provider terms: no relays, reselling, or getting around plan limits

## What's in this repo

| Path | What's there |
|---|---|
| [research/spec-token-utilization.md](research/spec-token-utilization.md) | Chompyy spec draft: board, blueprints, taste, quota reader, away runs, architecture, risks |
| [research/landscape-2026-11.md](research/landscape-2026-11.md) | The survey: 71 projects in 10 angles, their growth, independent evidence, and the open gaps |
| [research/atomic-knowledge.md](research/atomic-knowledge.md) | One fact per card (fact → source → harness rule), from provider docs and papers, ending in a minimal-harness sketch and what's still open |
| [research/feature-convergence.md](research/feature-convergence.md) | headroom, rtk, ponytail, token-optimizer, caveman, codeburn, TokenEconomizer side by side, and the risks of stacking them |
| [research/papers/papers.md](research/papers/papers.md) | 106 papers on token use, one finding each, linked to the cards |
| [tools/paper_search.py](tools/paper_search.py) | arXiv search + Semantic Scholar citation counts |
| [skills/scout-oss-project/](skills/scout-oss-project/SKILL.md) | A skill for agents: profile one new project, or survey a theme, in a shape that compares |
| [tools/discover.sh](tools/discover.sh) | Wide-net GitHub search (keywords + topics + named lookups) |
| [tools/repo_stats.py](tools/repo_stats.py) | Stars, age, licence, and the current star rate for any repo |
| [tools/landscape_tables.py](tools/landscape_tables.py) | Joins a snapshot with [data/angles.tsv](data/angles.tsv) into the survey's tables |
| [data/snapshots/](data/snapshots/) | Dated stats snapshots; diff two of them for real growth |

```bash
tools/discover.sh 150 > /tmp/candidates.tsv                                    # find
python3 tools/repo_stats.py owner/name >> data/snapshots/$(date +%F).jsonl     # measure
python3 tools/landscape_tables.py data/snapshots/$(date +%F).jsonl             # tabulate
```

Needs `gh` (logged in), `jq` and Python 3.9+.
