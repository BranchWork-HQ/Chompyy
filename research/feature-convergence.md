# Feature convergence: the six tools people use most

What headroom, rtk, ponytail, token-optimizer, caveman and codeburn each do, side by side, plus TokenEconomizer for the learning column. Read from each README on 2026-11-10 (features as described, code not read). Stats: [landscape](landscape-2026-11.md).

**Answer first:** they are converging on one shape — **compress what comes in, nudge what goes out, show the spend in a band above the prompt**. caveman became six parts; ponytail added a cost band and board; token-optimizer does nearly everything. What none of them does: plan the quota window, check quality with paired runs, or know what happens when you run two of them together.

✅ does it · ◐ partly / opt-in · – not in the README

| Mechanism | headroom | rtk | ponytail | token-optimizer | caveman | codeburn | TokenEconomizer |
|---|---|---|---|---|---|---|---|
| **Output: terse prose** | ◐ verbosity note at the *end* of the system prompt | – | ◐ ends replies with what was skipped | ✅ lean-output nudge | ✅ the core skill (3 levels) | – | – |
| **Output: less code** | – | – | ✅ YAGNI ladder, never cuts validation/security | – | – | – | – |
| **Input: shell / tool output** | ✅ tool outputs, logs, JSON | ✅ 100+ commands, Rust, < 10 ms | – | ✅ bash and search compression | ✅ logs, JSON, CSV, tests | – | – |
| **Input: file reads** | ✅ files, RAG chunks | ✅ `cat` → signatures | ◐ reads first, but reads fully | ✅ delta diffs, skeletons | – | – | – |
| **Input: web pages** | – | – | – | – | ✅ Browse (129×) | – | – |
| **Reversible (get the original back)** | ✅ CCR store | – | – | ✅ archive + `expand` | – | – | – |
| **History / compaction** | ✅ compresses history | – | – | ✅ checkpoint before compaction, restore after | – | – | – |
| **Startup tax audit** (configs, unused skills/MCP) | – | – | – | ✅ per-component report | ◐ "waste fixes" | ✅ `optimize` | ✅ prunes unused tools automatically |
| **Cache safety by design** | ✅ CacheAligner flags volatile prefix; never rewrites | ✅ filters before history | n/a (prompt only) | ✅ never touches the prefix | – | ◐ reports cache hit rate | ✅ prices cache as billed |
| **Keep the cache warm while you pause** | – | – | – | ◐ opt-in ping, auto-off | ✅ only when your history says you'll be back | – | – |
| **Route model / effort** | – | – | – | ◐ routing nudges, `route` | ✅ Auto (needs an account) | ◐ `compare` models on your own history | – |
| **Code mode** (keep scripts, rerun them) | – | – | – | – | ✅ Blocks | – | – |
| **Learn across sessions** | ✅ `headroom learn` → CLAUDE.md | – | ◐ `shortcut:` debt ledger | ◐ decision extraction, cold resume | – | – | ✅ micro-skills (3 confirmations, dropped on contradiction) |
| **Loop guard** | – | – | – | ✅ loop detection | – | ◐ spending caps (`guard`) | ✅ judge-checked redirect |
| **Spend view** | ◐ stats | ◐ savings (chars ÷ 4) | ✅ band + board | ✅ dashboard + status bar | ◐ `caveman stats` | ✅ the deepest: by project, branch, task, PR | ✅ reports |
| **Quota / window view** | – | – | – | ✅ both limits in the bar | – | ✅ `quota`, plan pacing | – |
| **Checks its own promise** | – | – | ◐ own benchmark | – | ◐ own paired report | ✅ `act report`: fix promised vs sessions after | ✅ paper |
| **Hooks in** | library, proxy, wrap, MCP | shell hook, proxy | skill + hooks | plugin + hooks + mod | skill, proxy, CLI | CLI, app | plugin |
| **Licence** | Apache-2.0 | Apache-2.0 | MIT | custom (check) | Apache-2.0 | MIT | MIT |

## What each one has that the others don't

| Tool | Its one thing worth taking |
|---|---|
| rtk | breadth: a tested filter per command, fast, applied before history (so cache-safe) |
| headroom | the CacheAligner rule and reversible compression (CCR) |
| ponytail | a quality floor written into the prompt: what may never be cut |
| token-optimizer | surviving compaction: checkpoint, restore, cold resume |
| caveman | keep-warm decided by *your* return pattern; code mode (Blocks) |
| codeburn | the measure → fix → re-measure loop, and the live quota |
| TokenEconomizer | learning with a confirmation rule (3 sessions) and a way to forget |

## Stacking risks (untested, from the mechanisms)

1. **Double compression**: rtk + headroom + caveman "Read less" all shrink the same shell output; the second pass saves little and can drop what the first kept.
2. **Prompt pile-up**: caveman + ponytail + token-optimizer each add instructions to every session; three "be lean" skills are a startup tax of their own.
3. **Cache churn**: anything that rewrites content already sent (proxy-mode rewriting, history compression) invalidates the cached prefix; with a cache write costing 1.25–2× input, a compression that breaks the cache can cost more than it saves.
4. **Fighting nudges**: a router picking a cheap model while a skill pushes extra verification steps.

These are the cells a paired benchmark would fill.
