# token-saving-research

Research spun out of [BranchWork](https://github.com/BranchWork-HQ/branchwork): how to get more done per token with coding agents such as Claude Code. It covers what exists, what actually works when measured, and where there's room left.

## Why

In [branchwork#107](https://github.com/BranchWork-HQ/branchwork/pull/107), a lean harness running a cheap model matched Opus on Aider Polyglot (34/34) at 1/39 of the cost. About 80% of plain Claude Code's cost there was the cache write at startup. So the harness matters more than the model, and most of the bill sits where few tools look.

## Scope

Token saving only, in every direction:

- **Cache cost**: keep the prompt prefix stable and cheap to write, and don't break it
- **Routing**: send each task to the cheapest model that can do it
- **Window planning**: queue tasks that are safe to run unattended, so subscription quota windows don't reset unused while you're away
- **Skill distillation**: turn verified successful runs into short skills that cheaper models can follow
- **Convergence**: combine what the popular tools (rtk, headroom, caveman, ponytail, token-optimizer, codeburn) do well into one minimal harness and plugin

## Rules

- Claims are measured: priced at real cache rates, with pass rate alongside cost
- Every finding cites a source: a paper, a provider doc, or a run
- Stays within provider terms: no relays, reselling, or getting around plan limits

## Status

The first survey (open-source projects, ~100 papers, and the knowledge cards built from them) is on its way in a PR for [#1](https://github.com/BranchWork-HQ/token-saving-research/issues/1).
