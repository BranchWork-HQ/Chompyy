# token-optimizer: what the code actually does

- Repo: https://github.com/alexgreensh/token-optimizer · commit `bbf3b8ca54ff69efb4baab25d272bb715863aef9` (2026-11-16)
- Licence: **PolyForm Noncommercial 1.0.0** + a small-business permission (< 5 people and < $20k/month). **Chompyy copies no code or text from it.** These notes record facts and ideas (not copyrightable) in our own words.
- Size: ~2,100 files, mostly Python (`scripts/_measure/` ≈ 100 modules) plus per-agent ports. Read: `skills/token-optimizer/SKILL.md`, `references/optimization-checklist.md` (quick wins, anti-patterns, settings), the docstrings of `_measure/{file_refetch,output_reread,compaction_survival,keepwarm_economics,rework_metrics,first_call_context}.py`. Not read line by line: the dashboard, daemon, Codex/Cursor/OpenCode ports, archives.

## How it works
An audit skill, not a background tool: six cheap-model agents each audit one area (CLAUDE.md, MEMORY.md, skills, MCP, commands, settings + hooks), one strong-model agent writes the plan, the user approves, changes are applied one at a time with backups, then a verification agent re-measures. If a number got worse, it restores that file.

## Facts and rules worth keeping (in our words)
| Topic | What it says / does |
|---|---|
| CLAUDE.md size | Anthropic's documented guidance is **under 200 lines per file** (code.claude.com/docs/en/memory). Tier it: always-loaded essentials; workflows as skills (on demand); long guides as files referenced explicitly |
| MEMORY.md | Remove anything duplicated in CLAUDE.md; one source of truth |
| Archiving skills | A folder like `skills/_archived/` **still loads**; move archived skills outside `skills/` |
| `permissions.deny` for files (`node_modules/**`, `dist/**`, logs, `.env`) | Costs zero tokens per turn, **but** every blocked attempt returns an error that stays in history; deny only paths the agent wouldn't read anyway; project level before global |
| MCP | Don't assume MCP overhead is huge: **Tool Search defers tool definitions by default** in current Claude Code |
| Cache lifetime | Main conversation: **1 h on subscription plans**, 5 min on API keys/credits/cloud; **subagents: 5 min even on a subscription**. Settings `promptCacheTtl`, `subagentPromptCacheTtl`. (Checked on this machine: recent sessions write `ephemeral_1h_input_tokens`.) |
| Compaction | Every compaction rebuilds the cache. Compact at phase boundaries (after research, after debugging, after a milestone), not mid-task. `/autocompact <n>` or `autoCompactWindow` sets an earlier window; flag a stray `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` |
| Subscription users | **Don't quote dollar savings to subscription users**; talk context budget and % of window |
| Keep-warm | Built, then **paused**: "a ping uses plan limits or API credits", off until proven safe and saving |

## Measurement discipline (the best part)
- **Decision rules fixed before measuring** (`file_refetch.py`): after an elided shell print of a file, did the session fetch the same file again within 3 tool calls? < 200 events → can't measure; re-fetch > 15 % → make it lossless; < 5 % → may compress more; else no change.
- **Output not written is also never re-read** (`output_reread.py`): a shorter reply saves its own output tokens plus a cache read on every later turn until compaction. Credits are **signed** (a reply that grew is a debit) and **net of a control** (same change in sessions that were never nudged).
- **Counterfactual compaction weight** (`compaction_survival.py`): estimates whether a session would have compacted, from the user's own distribution of compaction sizes (`compact_boundary` → `preTokens` in transcripts), instead of a fixed rule.
- **Rework is observational, not savings** (`rework_metrics.py`).

## What Chompyy's detective takes
1. **Cache lifetime by plan**: on a subscription, a pause costs a cache rebuild only after **1 h** (main) or **5 min** (subagents). Read the real lifetime from each turn's `cache_creation` breakdown rather than assuming.
2. **Deny-rule advice with its caveat**: suggest `permissions.deny` only for paths the agent read and never used (build output, lockfiles, vendored code); check for "permission denied" repeats afterwards.
3. **MCP advice tempered**: with Tool Search on, unused MCP servers cost far less than older tools claim; measure (first-turn prefix) before advising.
4. **Compaction timing** advice from the user's own `compact_boundary` events: compactions mid-task followed by re-reads → suggest compacting at phase boundaries or an earlier window.
5. **Pre-registered decision rules** for every "did it work?" check: write the threshold down before measuring, keep credits signed, net of a control.
6. **Skill archiving location** and **MEMORY.md/CLAUDE.md duplication** as config checks.
