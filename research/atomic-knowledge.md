# Atomic knowledge: how tokens get spent, one fact at a time

Each card is one mechanism: **fact → source → what a harness should do**. Cards are small on purpose, so a design can cite exactly which facts it stands on, and a new paper changes one card, not the whole doc.

Confidence: **D** = provider documentation (the rules of the game), **M** = measured in a controlled study, **C** = claimed (vendor or single run), **H** = our hypothesis, untested.

Paper list behind the M cards: [papers/papers.md](papers/papers.md).

## A. The bill: what you pay for (Claude, 2026-11)

Source for A1–A12: Anthropic prompt-caching and cost-optimisation docs as bundled in Claude Code's `claude-api` reference (cached 2026-10-06; live pages win where they differ: platform.claude.com/docs/en/build-with-claude/prompt-caching).

| # | Fact | Conf. | Harness rule |
|---|---|---|---|
| A1 | The cache is a **byte-exact prefix match**. One changed byte at position N invalidates every breakpoint at or after N. | D | Never edit what was already sent. Append only. |
| A2 | Render order is **tools → system → messages**. Adding, removing or reordering a tool invalidates *everything*. | D | Fix the tool set for a whole session; sort tools by name. Choosing tools is a session-start decision. |
| A3 | Caches are **model-scoped**. Switching model mid-conversation is a full rebuild. | D | Route per *session* or per *subagent*, never per turn inside one conversation. |
| A4 | Cache write = **1.25× input (5-min TTL)** or **2× (1-hour TTL)**; read = ~**0.1×** (0.05× on Opus 5.5, 0.025× on Fable 5.1). | D | A prefix must be read 2+ times (5 min) or 3+ times (1 h) to pay back. One-shot sessions with a big startup pay the write for nothing. |
| A5 | TTL counts from the **start** of the request; a read refreshes it for free. Gaps under 5 min keep the 5-min cache warm indefinitely. | D | Keep turns inside 5 min, or keep-alive with a `max_tokens: 0` re-send (bills a read only) instead of paying the 1-hour write. |
| A6 | `thinking` or `effort` changes **invalidate the messages cache**; per-message effort (beta) avoids it on newer models. | D | Pin effort per route; change it through a mid-conversation system message, not the top-level field. |
| A7 | Timestamps, UUIDs, unsorted JSON, per-user tool lists in the prefix are **silent invalidators**. | D | Lint the prefix. Put anything dynamic after the last breakpoint. |
| A8 | Each breakpoint looks back **at most 20 positions**; a long sequential turn can push the previous entry out of reach → full rewrite. | D | In long tool loops, add an intermediate breakpoint every ~15 positions. |
| A9 | Minimum cacheable prefix: **512 tokens** on the 5.x models (1,024–4,096 on older ones). Below it, nothing caches, silently. | D | Tiny prompts can't cache; don't design for it. |
| A10 | **Context editing** (clearing old tool results) rewrites the cached conversation; in Anthropic's measured run it **cost more than it saved**. Compaction saved ~⅓ only on a long run, nothing on a short one. | D (measured by provider) | Clearing and compaction are window tools, not savings tools. Clear rarely, in big batches. **A documented negative interaction between two levers.** |
| A11 | **Batch API: −50 % on every token, stacking with cache discounts.** Single-shot, no tool loop, no subscription. | D | For unattended API work only; a subscription harness can't use it. |
| A12 | **Re-run only failures at higher effort**: held the pass rate of running everything high, for a little over half the cost (Anthropic coding runs). Cheaper *per completed task* is the only fair unit. | D (measured by provider) | Cascade on a *failure signal* (tests), not on a guess. Count the failed cheap attempts in the cost. |

## B. Where an agent's tokens go

| # | Fact | Conf. | Source | Harness rule |
|---|---|---|---|---|
| B1 | In a 500-session Claude Code bill: **42 % cache writes, 29 % output, 29 % reads + fresh input**. | C (one person's data) | codepointer replay [E4] | Optimise writes and output first; input compressors work on under a third. |
| B2 | Plain Claude Code starts at **19.4k tokens** before your first word; own prompt + 4 tools = 3.8k; ~800 tokens per tool description. | M (our measurement) | BranchWork #116 | Every tool must earn its place in the prefix. |
| B3 | On short tasks, the startup cache write was **~80 %** of default Claude Code's cost. | M (64 runs) | BranchWork PR #107 row 37 | For short tasks, startup *is* the bill. |
| B4 | Input dominates agent cost; the same task varies **up to 30×** in tokens; models predict their own spend at r ≤ 0.39. | M | 2604.22750 | Quote ranges from history, not from the model's guess. |
| B5 | Spend is predictable from **cheap signals**: one probe run (within 36 %), task spec + effort, a ~2B model's prefill (length predicts cost better than predicted success). Output length is heavy-tailed: predict a range. | M | 2608.25399, 2611.09028, 2604.07931 | Quote from a probe + history, as a range. Price routes by predicted length, not a fixed per-model cost. |
| B6 | **The harness alone changes tokens per solved task up to 40×**; pass rates move 0–8 points. | M | 2607.22585; PR #107 (39×) | The harness is the biggest lever and the least reported. Always report harness + model as a pair. |
| B7 | Messy code costs more to work on: maintainability predicts agent review cost (via file size). | M (pre-registered) | 2610.21914 | Small files are a token saving, too. |

**A13** (side note): shared caches are a timing side channel (2502.07776); cheap tokens are not cheap compute (2611.10315: −86 % fresh tokens, −8 % energy). Billing rules, not physics, decide the saving.

## C. Compression: what survives contact with agents

| # | Fact | Conf. | Source | Harness rule |
|---|---|---|---|---|
| C1 | Token-level compressors (LLMLingua family) work on prose QA (up to 20×) but **collapse agents**: 17/17 cells fell to reward ≤ 0.05 because they delete identifiers, brackets and verbs. Step-level compression with an always-keep floor works. | M | 2310.05736, 2403.12968, **2605.26596** | Never compress code, paths, IDs or tool calls token by token. Drop or keep whole steps. |
| C2 | **Deleting history breaks the cache.** 42 deletion configs, 9,400 runs: flat pricing → 26 save; **cache-aware pricing → 0 save**; agents re-fetch what was deleted. Truncation halves the prefix-hit ratio in production. AgentDiet / TraceLite savings were priced flat. | M | **2610.35496**, 2510.09665, 2509.23586 | Compress **before** content enters history (rtk-style), never after. Any savings claim must be priced with cache rates. |
| C3 | Less context can **raise** quality: decision-preserving compression +8.9 points; moderate compression helps on long contexts; irrelevant context interferes. | M | 2609.37590, 2505.00019, 2508.04664 | The goal is less irrelevant context, not fewer tokens for their own sake. |
| C4 | Fewer tokens ≠ faster or cheaper: a third of the tokens took 20–80 % longer; equal success rates solved different tasks. | M | 2609.32961, 2608.31057 | Measure wall-clock, turns and solved-set overlap, not just tokens. |
| C5 | Reasoning and tool output become safe to drop once their result is **externalised** (code, files, test output). | M | 2609.29875, 2608.29363 | Make the agent write state to files; then a *fresh session* (new cache, small prefix) can replace a long one. |

## D. Long context and quality

| # | Fact | Conf. | Source | Harness rule |
|---|---|---|---|---|
| D1 | Facts in the **middle** of a long context are used worst; start and end best. | M (5.9k cites) | 2307.03172 | Stable instructions first (cached), the task and fresh evidence last. Both rules agree with caching. |
| D2 | Effective context ≪ advertised: half of "32k+" models fail at 32k; without keyword overlap, 11/12 models halve their score at 32k. | M | 2404.06654, 2502.05167, 2509.09614 | A long session isn't just costlier, it's dumber. Rotate sessions before quality drops. |
| D3 | Answer quality is an inverted U in the number of retrieved chunks. | M | 2409.01666 | Retrieve less, in order. |
| D4 | Tool use degrades 7–85 % as the tool count grows; multi-tool tasks fail if any needed tool is missing (21/21 vs 2/39). | M | 2505.10570, 2610.41905, 2503.01763 | Few tools — but the *complete* set for the task. Pick per task type at session start (A2). |
| D5 | Many "shorter is better" results confound length with dropped evidence. | M | 2608.03297 | When testing context cuts, control for what was removed. |

## E. Doing less: turns, instructions, reasoning, output

| # | Fact | Conf. | Source | Harness rule |
|---|---|---|---|---|
| E1 | A turn cap at the 75th percentile cut cost 24–68 % with little solve loss; **extensions on request** saved another 12–24 %. | M | 2510.16786 | Cap turns from history; let the agent ask for more with a reason. |
| E2 | Shorter skills and tool descriptions *improved* quality 2.8 % (48 % / 39 % shorter); retrieve tools per task. | M | 2603.29919, 2505.06416 | Every instruction token competes for attention and cache. Write skills short. |
| E3 | A repo AGENTS.md cut runtime 28.6 % and output 16.6 %. | M | 2601.20404 | Tell the agent the repo's facts once instead of letting it rediscover them (see G2). |
| E4 | Higher effort spends more on **every** task, even ones a lower setting solves; difficulty-adaptive and budget-aware reasoning cut 30–50 % at equal accuracy. | M | 2502.15631, 2503.04472, 2412.18547 | Low effort by default, raise on failure (A12). |
| E5 | Concise reasoning (Chain of Draft) matches CoT at 7.6 % of the tokens; but what helps is the *content* of reasoning, and forced brevity hurt a weaker model on math 27.7 %. | M | 2502.18600, 2606.30128, 2401.05618 | Terse prose is safe for strong models on routine work; don't force it on hard reasoning or weak models. (Matches caveman's measured −8.5 %.) |

## F. Structure: how to split the work

| # | Fact | Conf. | Source | Harness rule |
|---|---|---|---|---|
| F1 | **Folding**: run sub-tasks in branches and fold back only the result → 10× smaller active context, equal or better results. | M | 2510.11967, 2510.24699, 2603.04257 | Subagents with their own (cached) prefix return a short result. Long history never accumulates in the main thread. |
| F2 | Routers cut cost 2×+ at equal quality, but the oracle gap is large, and they overpay by preferring strong models; per-role model choice in multi-agent setups cut 52–85 %. | M | 2406.18665, 2601.07206, 2602.03478, 2610.31743 | Route by role or task type, learned from your own results. |
| F3 | Pruning chatter between agents: same results at $5.6 vs $43.7. | M | 2410.02506, 2510.26585 | Agents exchange results, not transcripts. |
| F4 | Multi-agent rounds share most context: cache sharing gives 2–17× on the serving side. | M (serving) | 2604.03143, 2507.07400 | Give parallel subagents an identical prefix so they hit the same cache. |
| F5 | Batching 100 items per prompt stays within 2 points of one-at-a-time. | M | 2604.03684 | Group small similar jobs into one call. |

## G. Memory and skills (your skill-distillation idea)

| #   | Fact                                                                                                                                                                                                                           | Conf. | Source                                         | Harness rule                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| G1  | Reusable skills, workflows and plans pay off: workflow memory +24–51 % success with fewer steps; plan caching −50 % cost; compiled program skills up to +32 %.                                                                 | M     | 2409.07429, 2506.14852, 2610.39508, 2305.16291 | Turn repeated work into a skill, ideally a **script** (code mode) rather than prose.                            |
| G2  | Learning a repo's facts across sessions + pruning unused tools + a loop guard: −18–31 % cost, Pass@1 up.                                                                                                                       | M     | 2610.22732                                     | Confirm a fact 3× before trusting it; drop it when contradicted.                                                |
| G3  | Inheriting a previous session's memory: root cause found 21/24 vs 6/24, at 4.5× lower tokens.                                                                                                                                  | M     | 2610.36153                                     | End every session by writing what was learned.                                                                  |
| G4  | **Strong model distils, cheap model runs**: skills compiled from a teacher's verified traces raise weaker executors 4.5–18.8 points; strong-model procedural memory transfers; an 8B model with memory beats a memoryless 14B. | M     | **2611.01386**, 2508.06433, 2512.10696         | Exactly the #113 idea, now with evidence: distill on the strong model occasionally, run daily on the cheap one. |
| G5  | **Ungoverned memory hurts**: self-generated skills can degrade success; stored experience reproduces errors; raw trajectories or summaries don't help, governed store/recall/forget does (−17 % cost).                         | M     | 2602.20867, **2610.27406**, 2610.27377         | Distill only from *verified* successes; expire and re-check skills; never store a failure as a recipe.          |
| G6  | Semantic (answer) caches need error bounds; multi-turn caching avoids 35–41 % of generation cost on repetitive dialogues.                                                                                                      | M     | 2502.03771, 2611.01077                         | Useful for repeated questions, rarely for coding.                                                               |

## H. Combining levers (the angle you asked about)

| # | Fact | Conf. | Source | So |
|---|---|---|---|---|
| H1 | Local-Splitter tested 7 tactics singly, in pairs and greedy subsets on 4 coding workloads: **the best subset depends on the workload.** | M | 2604.12301 | The policy idea is published. What's open is narrower (below). |
| H2 | FrugalGPT combined cache + prompt adaptation + cascades (2023, single-call QA). | M | 2305.05176 | Old, not agentic. |
| H3 | Known negative interactions: deletion × cache (C2), context editing × cache (A10), compression × wall-clock (C4), cascade × cache (A3), memory × error reproduction (G5). | M/D | above | Most savings levers fight the cache. That's the shared mechanism. |
| H4 | API relays bill unexplained extra tokens. | M | 2611.07650 | "Within legal range" also means: use first-party access, read the bill. |

## What the cards say a minimal harness looks like

```
 session start (decided once, then frozen = cached)
   ├─ task type → tool set (few, complete)  [A2, D4]
   ├─ repo facts + distilled skill for this type  [E3, G2, G4]
   ├─ model + effort for this type (cheap, low)  [A3, E4, F2]
   └─ turn cap from history, extendable  [E1]
 during
   ├─ append only; compress output BEFORE it enters history  [A1, C1, C2]
   ├─ sub-tasks fold into subagents with a shared prefix  [F1, F4]
   ├─ turns < 5 min apart, or keep-alive read  [A5]
   └─ state written to files as it's produced  [C5]
 end / failure
   ├─ fail → rerun at higher effort, not a bigger model mid-session  [A12, A3]
   ├─ long session → fresh session from the files, not compaction  [C5, D2, A10]
   └─ verified success → distil / update skill; failure → never stored as recipe  [G4, G5]
```

Nine of these rules are about **not breaking the cache** or **not filling the context**. That is the core of "minimalism" with evidence behind it.

## What's still open (the contribution)

1. **Third-party tools, combined, on a cache-aware bill.** Local-Splitter used its own tactics behind a local model and counted cloud tokens; Hidden Costs of Forgetting tested only deletion. No one has priced rtk / headroom / caveman / ponytail / token-optimizer *in combination* with cache rates and pass rate on a real harness.
2. **Subscription economics.** Every paper prices API tokens. On a plan, the binding limit is the 5-hour and weekly window; what's optimal there (cache reads count?, window share per task) is unmeasured.
3. **Distillation with governance on coding.** G4 and G5 together: distill from verified runs, expire on contradiction, run on the cheap model. Pieces exist (TokenEconomizer, Learning by Doing, REM); one measured loop on daily coding work doesn't.

