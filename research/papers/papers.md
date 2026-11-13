# Papers: 106 on token use, one finding each

Collected 2026-11-10 with [`tools/paper_search.py`](../../tools/paper_search.py) from 36 arXiv queries ([queries.txt](queries.txt)): 1,163 hits, screened by hand to 106 ([selected.txt](selected.txt)). Citation counts from Semantic Scholar on the same day. Findings are read from abstracts, not full papers; **check the paper before quoting a number**. *Card* links to [atomic-knowledge.md](../atomic-knowledge.md).

## Provider caches (13)

| Paper | Date | Cites | Finding | Card |
|---|---|---|---|---|
| [Semantic Caches for LLM Web Services Leave Their Error Budget Unspent](https://arxiv.org/abs/2611.02498) | 2026-11 | 0 | Semantic caches can be tuned to spend an explicit error budget safely: 40 % more hits than vCache at the same error bound | G6 |
| [Multi-Turn Semantic Caching for Low-Cost LLM Serving](https://arxiv.org/abs/2611.01077) | 2026-10 | 0 | Multi-turn semantic caching avoids 35–41 % of generation cost in task dialogues (baselines ≤ 25 %) | G6 |
| [Rethinking KV Cache Eviction for Agentic LLM Serving](https://arxiv.org/abs/2611.00391) | 2026-10 | 0 | Agent traces need different KV eviction than chat (job-level reuse): up to 60 % lower completion time | A1 |
| [TokenDance: Scaling Multi-Agent LLM Serving via Collective KV Cache Sh…](https://arxiv.org/abs/2604.03143) | 2026-04 | 16 | Multi-agent rounds share most context; diff-based collective KV sharing cuts per-agent KV storage up to 17.5× | F4 |
| [Don't Break the Cache: An Evaluation of Prompt Caching for Long-Horizo…](https://arxiv.org/abs/2601.06007) | 2026-01 | 27 | Caching cut agent API cost 41–80 % across OpenAI, Anthropic, Google (500+ sessions); excluding dynamic tool results and putting dynamic content last beat naive full-context caching, which can even raise latency | A1 |
| [LMCache: An Efficient KV Cache Layer for Enterprise-Scale LLM Inferenc…](https://arxiv.org/abs/2510.09665) | 2025-10 | 209 | In enterprise serving, context truncation (a common trick) **halves the prefix-cache hit ratio** | C2 |
| [KVFlow: Efficient Prefix Caching for Accelerating LLM-Based Multi-Agen…](https://arxiv.org/abs/2507.07400) | 2025-07 | 93 | Scheduling-aware prefix caching for multi-agent workflows: up to 2.19× speedup | F4 |
| [Agentic Plan Caching: Test-Time Memory for Fast and Cost-Efficient LLM…](https://arxiv.org/abs/2506.14852) | 2025-06 | 34 | Caching *plans* (not answers) and adapting them with a small model cut agent cost 50 % and latency 27 % at equal performance | G1 |
| [Auditing Prompt Caching in Language Model APIs](https://arxiv.org/abs/2502.07776) | 2025-02 | 31 | Statistical audits found prompt caches shared across users at 7 API providers: cache hits are a timing side channel | A13 |
| [vCache: Verified Semantic Prompt Caching](https://arxiv.org/abs/2502.03771) | 2025-02 | 22 | Semantic caches need a per-entry threshold to stay within an error bound; fixed thresholds give wrong reused answers | G6 |
| [GPT Semantic Cache: Reducing LLM Costs and Latency via Semantic Embedd…](https://arxiv.org/abs/2411.05276) | 2024-11 | 35 | Semantic embedding cache cut API calls up to 68.8 % on repeated query categories, > 97 % correct hits | G6 |
| [CacheBlend: Fast Large Language Model Serving for RAG with Cached Know…](https://arxiv.org/abs/2405.16444) | 2024-05 | 364 | Reusing KV caches of non-prefix text chunks (with partial recompute) cuts TTFT 2.2–3.3× for RAG | A1 |
| [Prompt Cache: Modular Attention Reuse for Low-Latency Inference](https://arxiv.org/abs/2311.04934) | 2023-11 | 431 | Reusing attention states for shared prompt modules cuts time-to-first-token 8× (GPU) to 60× (CPU) with no accuracy loss | A1 |

## Agent cost & harness (15)

| Paper | Date | Cites | Finding | Card |
|---|---|---|---|---|
| [Repeating Work Can Lower Energy per Successful Goal in LLM Agents](https://arxiv.org/abs/2611.10315) | 2026-11 | – | Keeping the prefix cache cuts fresh prompt tokens 86 % on recovery but energy only 8 %: cheap tokens ≠ cheap compute | A13 |
| [What the Middleman Delivers: Answer Behavior, Tool Permissions, and Bi…](https://arxiv.org/abs/2611.07650) | 2026-11 | 0 | Third-party API relays bill unexplained extra input tokens and violate tool permissions; advertised price ≠ what you get | H4 |
| [Not Every Agent Needs the Strongest Model: Unified Prompt-Model Optimi…](https://arxiv.org/abs/2610.31743) | 2026-10 | 0 | Assigning cheaper models to some agent roles cut multi-agent cost 85 % at equal or better score | F2 |
| [TraceLite: Efficient Trace Reduction for SWE Agents via Optical Compre…](https://arxiv.org/abs/2610.28612) | 2026-10 | 0 | TraceLite: trace reduction (incl. rendering as images) cut input 33 % and cost 21 % at equal resolution rate | C2 |
| [TokenEconomizer: Experience-Driven Black-Box Cost Control for Coding A…](https://arxiv.org/abs/2610.22732) | 2026-10 | 0 | TokenEconomizer: repo micro-skills + tool pruning + loop guard cut coding-agent cost 18.4–30.9 % across 5 agent–model pairs | G2 |
| [CodeHealth Predicts the Token Cost of Agentic Code Review: A Pre-Regis…](https://arxiv.org/abs/2610.21914) | 2026-10 | 0 | Code health (maintainability) predicts the token cost of agentic code review, mediated by file size (pre-registered) | B7 |
| [Can your AI agent be cheaper? Investigating the effects of task specif…](https://arxiv.org/abs/2608.25399) | 2026-08 | 1 | Task specification and effort shape agent token spend; one cheap probe predicts the spend distribution within 36 % | B5 |
| [The Scaffold Effect in Coding Agents: Harness Choice as a Hidden Varia…](https://arxiv.org/abs/2607.22585) | 2026-06 | 16 | Harness choice alone changes tokens per solved task up to **40×**, while pass rates differ 0–8 points | B6 |
| [How Do AI Agents Spend Your Money? Analyzing and Predicting Token Cons…](https://arxiv.org/abs/2604.22750) | 2026-04 | 50 | Agent token use varies up to 30× on the same task; input dominates; models predict their own spend at r ≤ 0.39 and underestimate | B4 |
| [Local-Splitter: A Measurement Study of Seven Tactics for Reducing Clou…](https://arxiv.org/abs/2604.12301) | 2026-04 | 0 | Local-Splitter: 7 tactics singly, in pairs and greedy subsets; local routing + compression saved 45–79 % cloud tokens; **the best subset depends on the workload** | H1 |
| [On the Impact of AGENTS.md Files on the Efficiency of AI Coding Agents](https://arxiv.org/abs/2601.20404) | 2026-01 | 31 | An AGENTS.md file lowered median runtime 28.6 % and output tokens 16.6 % on 124 PRs, same completion | E3 |
| [Stop Wasting Your Tokens: Towards Efficient Runtime Multi-Agent System…](https://arxiv.org/abs/2510.26585) | 2025-10 | 19 | A supervisor agent that flags waste and cleans observations cut multi-agent tokens 29.7 % on GAIA at equal success | F3 |
| [More with Less: An Empirical Study of Turn-Control Strategies for Effi…](https://arxiv.org/abs/2510.16786) | 2025-10 | 18 | A fixed turn cap at the 75th percentile cut cost 24–68 % with little solve-rate loss; on-demand extensions cut another 12–24 % | E1 |
| [Reducing Cost of LLM Agents with Trajectory Reduction](https://arxiv.org/abs/2509.23586) | 2025-09 | 73 | AgentDiet: removing useless/expired trajectory content cut input 40–60 % and cost 21–36 % at equal pass rate (flat pricing) | C2 |
| [Cut the Crap: An Economical Communication Pipeline for LLM-based Multi…](https://arxiv.org/abs/2410.02506) | 2024-10 | 182 | Pruning redundant messages between agents matches top multi-agent topologies at $5.6 vs $43.7 | F3 |

## Compression (13)

| Paper | Date | Cites | Finding | Card |
|---|---|---|---|---|
| [Tools Need Not Speak in Text: Latent Context Compression for Agents](https://arxiv.org/abs/2611.06500) | 2026-11 | 0 | Latent (non-text) tool-output compression cut web-agent tokens 70–89 % and runtime 24–56 % while raising accuracy (needs model access) | C1 |
| [FOCUS: Training-Free Decision-Preserving Context Compression for LLM A…](https://arxiv.org/abs/2609.37590) | 2026-09 | 0 | FOCUS: decision-preserving compression cut peak context 48 % and *raised* success up to 8.9 points on closed-API models | C3 |
| [Beyond Token Savings: A Systematic Study of Context Compression in LLM…](https://arxiv.org/abs/2609.32961) | 2026-09 | 4 | Context compression in agents: a third of the tokens can take **20–80 % longer** wall-clock; equal success rates hide different solved tasks; policy must fit task × model | C4 |
| [When Can Agents Forget Their Reasoning? ICLR for Long-Horizon Agent Co…](https://arxiv.org/abs/2609.29875) | 2026-09 | 2 | Past reasoning becomes safe to drop once its result is externalised into code, files or tool output | C5 |
| [Measure Before You Manage: Evaluating Agent Working Memory in Coding A…](https://arxiv.org/abs/2608.31057) | 2026-08 | 3 | Agent working memory is heterogeneous (instructions, artifacts, tool output, state); a nominal token budget misjudges management cost | C4 |
| [TRACER: Per-Tool Context Retention for LLM Agents via Consequence-Attr…](https://arxiv.org/abs/2608.29363) | 2026-08 | 1 | Learning per-tool retention (which tool outputs matter) cut tokens 18–25 % on held-out environments | C5 |
| [AGORA: Adapter-Grounded Observation-Action Retention for Inference-Fre…](https://arxiv.org/abs/2605.26596) | 2026-05 | 4 | AGORA: token-level compressors **collapse agents** (17/17 cells to reward ≤ 0.05) by deleting identifiers and brackets; step-level compression with an always-keep floor works | C1 |
| [An Empirical Study on Prompt Compression for Large Language Models](https://arxiv.org/abs/2505.00019) | 2025-04 | 11 | Compression hurts long contexts more than short ones; moderate compression can *help* on LongBench | C3 |
| [Understanding and Improving Information Preservation in Prompt Compres…](https://arxiv.org/abs/2503.19114) | 2025-03 | 23 | Compressors drop entities; controlling granularity preserves 2.7× more entities, +23 % downstream | C1 |
| [Prompt Compression for Large Language Models: A Survey](https://arxiv.org/abs/2410.12388) | 2024-10 | 99 | Survey of hard vs soft prompt compression; most methods need model access or fine-tuning | C1 |
| [Fundamental Limits of Prompt Compression: A Rate-Distortion Framework …](https://arxiv.org/abs/2407.15504) | 2024-07 | 28 | Rate-distortion bound: current prompt compressors sit far from the optimum; query-aware compression closes much of the gap | C1 |
| [LLMLingua-2: Data Distillation for Efficient and Faithful Task-Agnosti…](https://arxiv.org/abs/2403.12968) | 2024-03 | 502 | LLMLingua-2: faster, task-agnostic token classification; 2–5× compression, 1.6–2.9× end-to-end speedup | C1 |
| [LLMLingua: Compressing Prompts for Accelerated Inference of Large Lang…](https://arxiv.org/abs/2310.05736) | 2023-10 | 431 | LLMLingua: small-LM token pruning compresses prompts up to 20× with little loss (on QA/reasoning text) | C1 |

## Agent context management (9)

| Paper | Date | Cites | Finding | Card |
|---|---|---|---|---|
| [The Hidden Costs of Forgetting: A Study of Trajectory Deletion in Soft…](https://arxiv.org/abs/2610.35496) | 2026-10 | 0 | **42 trajectory-deletion configs, 9,400 runs: under flat pricing 26 save money; under cache-aware pricing 0 do** — deletion breaks the cached prefix, and agents re-fetch what was deleted | C2 |
| [Stratum: Repository Memory for Coding Agents Beyond the Context Window](https://arxiv.org/abs/2610.36153) | 2026-10 | 0 | Stratum: a fresh agent inheriting a prior session's repo memory found the root cause 21/24 vs 6/24, at 4.5× lower median tokens | G3 |
| [SkillReducer: Optimizing LLM Agent Skills for Token Efficiency](https://arxiv.org/abs/2603.29919) | 2026-03 | 43 | SkillReducer: cutting skill descriptions 48 % and bodies 39 % *improved* quality 2.8 % ("less is more"), transfers across 5 models | E2 |
| [Memex(RL): Scaling Long-Horizon LLM Agents via Indexed Experience Memo…](https://arxiv.org/abs/2603.04257) | 2026-03 | 17 | Indexed experience memory (store outside, dereference on demand) keeps working context small with higher success | F1 |
| [LOCA-bench: Benchmarking Language Agents Under Controllable and Extrem…](https://arxiv.org/abs/2602.07962) | 2026-02 | 24 | LOCA-bench: agents degrade as environment state grows; context-management strategies recover much of it | C3 |
| [AgentFold: Long-Horizon Web Agents with Proactive Context Management](https://arxiv.org/abs/2510.24699) | 2025-10 | 108 | AgentFold: proactive, multi-scale folding of history lets a 30B agent match much larger ones on BrowseComp | F1 |
| [Scaling Long-Horizon LLM Agent via Context-Folding](https://arxiv.org/abs/2510.11967) | 2025-10 | 172 | Context-Folding: branching into sub-trajectories and folding them back keeps active context 10× smaller with equal or better results | F1 |
| [Scaling LLM Multi-turn RL with End-to-end Summarization-based Context …](https://arxiv.org/abs/2510.06727) | 2025-10 | 57 | Summarisation-based context management lets RL-trained agents work beyond a fixed window | F1 |
| [Sculptor: Empowering LLMs with Cognitive Agency via Active Context Man…](https://arxiv.org/abs/2508.04664) | 2025-08 | 24 | Irrelevant context causes proactive interference; letting the model manage its own history improves long-context reasoning | C3 |

## Long context & quality (7)

| Paper                                                                                                       | Date    | Cites | Finding                                                                                                                      | Card |
| ----------------------------------------------------------------------------------------------------------- | ------- | ----- | ---------------------------------------------------------------------------------------------------------------------------- | ---- |
| [Distractor-Aware Truncation: Disentangling Context-Length Effects from…](https://arxiv.org/abs/2608.03297) | 2026-08 | 1     | Many "shorter context is better" results confound length with dropped evidence; measure with distractor-aware truncation     | D5   |
| [LoCoBench: A Benchmark for Long-Context Large Language Models in Compl…](https://arxiv.org/abs/2509.09614) | 2025-09 | 17    | LoCoBench: long-context software tasks remain far from solved even for million-token models                                  | D2   |
| [LongFuncEval: Measuring the effectiveness of long context models for f…](https://arxiv.org/abs/2505.10570) | 2025-04 | 27    | Tool calling degrades 7–85 % as the number of tools grows and 7–91 % as tool responses grow longer                           | D4   |
| [NoLiMa: Long-Context Evaluation Beyond Literal Matching](https://arxiv.org/abs/2502.05167)                 | 2025-02 | 160   | NoLiMa: without literal keyword matches, 11 of 12 long-context models fall to half their short-context score at 32k          | D2   |
| [In Defense of RAG in the Era of Long-Context Language Models](https://arxiv.org/abs/2409.01666)            | 2024-09 | 68    | RAG with fewer, order-preserved chunks beats stuffing the whole context: quality is an inverted U in the number of chunks    | D3   |
| [RULER: What's the Real Context Size of Your Long-Context Language Mode…](https://arxiv.org/abs/2404.06654) | 2024-04 | 1623  | RULER: only half of models claiming ≥ 32k context perform well at 32k; effective context ≪ advertised                        | D2   |
| [Lost in the Middle: How Language Models Use Long Contexts](https://arxiv.org/abs/2307.03172)               | 2023-07 | 5942  | Lost in the middle: accuracy is highest when the relevant fact is at the start or end of the context and drops in the middle | D1   |

## Routing & cascades (12)

| Paper | Date | Cites | Finding | Card |
|---|---|---|---|---|
| [Scout Before You Route: Predicting Task Success and Token Count from a…](https://arxiv.org/abs/2611.09028) | 2026-11 | 0 | Routers should price by *predicted length*, not fixed cost: a small-model prefill probe saves 22 % more; a ~2B scout is enough | B5 |
| [Predictable performance is suboptimal, and what it means for model rou…](https://arxiv.org/abs/2610.31428) | 2026-10 | 0 | Learned predictors beat model self-confidence for routing mainly on weaker models; the edge shrinks as models improve | F2 |
| [MTRouter: Cost-Aware Multi-Turn LLM Routing with History-Model Joint E…](https://arxiv.org/abs/2604.23530) | 2026-04 | 16 | Multi-turn router: 43 % lower cost vs GPT-5 alone, partly by **switching models less often** | A3 |
| [Dynamic Model Routing and Cascading for Efficient LLM Inference: A Sur…](https://arxiv.org/abs/2603.04445) | 2026-02 | 32 | Survey: routing and cascading can beat the best single model, generalisation is the open problem | F2 |
| [When LLM Routers Overpay: The Cost of Strong-Model Preference](https://arxiv.org/abs/2602.03478) | 2026-02 | 13 | Routers overpay by preferring strong models; cost-aware ranking fixes it | F2 |
| [LLMRouterBench: A Massive Benchmark and Unified Framework for LLM Rout…](https://arxiv.org/abs/2601.07206) | 2026-01 | 55 | LLMRouterBench: big gap remains to the oracle router; curating a few models beats large ensembles | F2 |
| [Adaptive LLM Routing under Budget Constraints](https://arxiv.org/abs/2508.21141) | 2025-08 | 33 | Budget-constrained routing as a bandit + knapsack, learned online from feedback | F2 |
| [MasRouter: Learning to Route LLMs for Multi-Agent Systems](https://arxiv.org/abs/2502.11133) | 2025-02 | 123 | Routing models per agent role in multi-agent systems cut overhead up to 52 % | F2 |
| [CARROT: A Cost Aware Rate Optimal Router](https://arxiv.org/abs/2502.03261) | 2025-02 | 53 | CARROT: cost-aware router with minimax-rate guarantees | F2 |
| [RouteLLM: Learning to Route LLMs with Preference Data](https://arxiv.org/abs/2406.18665) | 2024-06 | 954 | RouteLLM: routers trained on preference data cut cost > 2× at equal quality and transfer to new model pairs | F2 |
| [RouterBench: A Benchmark for Multi-LLM Routing System](https://arxiv.org/abs/2403.12031) | 2024-03 | 311 | RouterBench: a standard benchmark for multi-LLM routing (405k outcomes) | F2 |
| [FrugalGPT: How to Use Large Language Models While Reducing Cost and Im…](https://arxiv.org/abs/2305.05176) | 2023-05 | 1290 | FrugalGPT: cache + prompt adaptation + cascade together matched GPT-4 at up to 98 % lower cost (the early combined-tactics result) | H2 |

## Reasoning length (8)

| Paper | Date | Cites | Finding | Card |
|---|---|---|---|---|
| [Right, Wrong, or Unfinished: A Competing Risks Framework for Language-…](https://arxiv.org/abs/2611.05860) | 2026-11 | 0 | A single model of completion time and correctness predicts success at any token budget | B5 |
| [Wait, We Don't Need to "Wait"! Removing Thinking Tokens Improves Reaso…](https://arxiv.org/abs/2506.08343) | 2025-06 | 92 | Suppressing "Wait"-style self-reflection tokens cuts reasoning length 27–51 % without utility loss | E4 |
| [Plan and Budget: Effective and Efficient Test-Time Scaling on Reasonin…](https://arxiv.org/abs/2505.16122) | 2025-05 | 32 | Planning, then budgeting per sub-question: up to 39 % fewer tokens and higher accuracy | E4 |
| [THOUGHTTERMINATOR: Benchmarking, Calibrating, and Mitigating Overthink…](https://arxiv.org/abs/2504.13367) | 2025-04 | 37 | Reasoning models overthink easy questions badly; calibration is poor on trivially easy tasks | E4 |
| [Stop Overthinking: A Survey on Efficient Reasoning for Large Language …](https://arxiv.org/abs/2503.16419) | 2025-03 | 511 | Survey of efficient reasoning: model-, output- and prompt-based ways to curb overthinking | E4 |
| [DAST: Difficulty-Adaptive Slow-Thinking for Large Reasoning Models](https://arxiv.org/abs/2503.04472) | 2025-03 | 147 | Difficulty-adaptive thinking cuts reasoning tokens > 30 % without losing accuracy on hard problems | E4 |
| [The relationship between reasoning and performance in large language m…](https://arxiv.org/abs/2502.15631) | 2025-02 | 55 | Higher reasoning effort spends more tokens on *every* problem, including ones the lower setting already solves | E4 |
| [Token-Budget-Aware LLM Reasoning](https://arxiv.org/abs/2412.18547) | 2024-12 | 265 | Telling the model a token budget for its reasoning cuts CoT tokens with only slight accuracy loss | E4 |

## Output length (5)

| Paper | Date | Cites | Finding | Card |
|---|---|---|---|---|
| [Does Verbose Chain-of-Thought Really Help? In-Distribution Evidence th…](https://arxiv.org/abs/2606.30128) | 2026-06 | 0 | What helps in CoT is the content of the extra tokens (reasoning, checking), not their count; filler of equal length helps not at all | E5 |
| [How Well do LLMs Compress Their Own Chain-of-Thought? A Token Complexi…](https://arxiv.org/abs/2503.01141) | 2025-03 | 115 | Each problem has a minimal "token complexity"; models compress far less than they could, especially on easy questions | E5 |
| [Chain of Draft: Thinking Faster by Writing Less](https://arxiv.org/abs/2502.18600) | 2025-02 | 327 | Chain of Draft: minimal intermediate notes match CoT accuracy at as little as 7.6 % of the tokens | E5 |
| [Concise Thoughts: Impact of Output Length on LLM Reasoning and Cost](https://arxiv.org/abs/2407.19825) | 2024-07 | 135 | Constrained-length CoT prompts shorten answers; conciseness metrics proposed | E5 |
| [The Benefits of a Concise Chain of Thought on Problem-Solving in Large…](https://arxiv.org/abs/2401.05618) | 2024-01 | 112 | Concise CoT: −48.7 % response length with negligible loss overall, but −27.7 % accuracy on math for a weaker model | E5 |

## Tools (6)

| Paper | Date | Cites | Finding | Card |
|---|---|---|---|---|
| [Completeness and Cost of Retrieval Structures for Multi-Tool Requests …](https://arxiv.org/abs/2610.41905) | 2026-10 | 0 | Multi-tool tasks fail if retrieval misses any one tool: complete sets succeeded 21/21, incomplete 2/39 | D4 |
| [Lookahead-R: Budget-Aware Tool Retrieval via Execution-Centric Plannin…](https://arxiv.org/abs/2609.35811) | 2026-09 | 2 | Budget-aware tool retrieval that models latency picks better tools under resource limits | E2 |
| [Tools Are Not Islands: Set-Level Tool Retrieval for LLM Agents via Que…](https://arxiv.org/abs/2607.25718) | 2026-07 | 6 | Retrieve tools as *sets* (they depend on each other), not one by one | D4 |
| [Optimizing Agentic Language Model Inference via Speculative Tool Calls](https://arxiv.org/abs/2512.15834) | 2025-12 | 14 | Speculative tool calls raise agent serving throughput; proposes a provider "tool cache" endpoint | F4 |
| [ScaleMCP: Dynamic and Auto-Synchronizing Model Context Protocol Tools …](https://arxiv.org/abs/2505.06416) | 2025-05 | 53 | Dynamic MCP tool retrieval over 5,000 servers: retrieve tools per task instead of loading all | E2 |
| [Retrieval Models Aren't Tool-Savvy: Benchmarking Tool Retrieval for La…](https://arxiv.org/abs/2503.01763) | 2025-03 | 69 | Standard retrieval models are poor at retrieving tools, and bad retrieval lowers task pass rate | D4 |

## Memory & skills (15)

| Paper | Date | Cites | Finding | Card |
|---|---|---|---|---|
| [Learning by Doing: Autonomously Compiling and Curating Agent Skills fr…](https://arxiv.org/abs/2611.01386) | 2026-11 | 0 | Skills compiled from a teacher's **verified traces** raise three weaker executors' pass rates 4.5–18.8 points at every effort level | G4 |
| [Compile Away Uncertainty: Self-Evolving Agent Skills via Programmatic …](https://arxiv.org/abs/2610.39508) | 2026-10 | 0 | Compiling skills into validated programs and reusing them: up to +32 % task performance | G1 |
| [REM: What to Store, When to Recall, What to Forget in Experience Memor…](https://arxiv.org/abs/2610.27377) | 2026-10 | 0 | REM: governed experience (what to store, recall, forget) resolved more issues at 17 % lower cost; raw trajectories or summaries did not help | G5 |
| [More Memory, Worse Agents: Error Reproduction and Anti-Persistence in …](https://arxiv.org/abs/2610.27406) | 2026-10 | 1 | **More memory, worse agents**: stored experience reproduces past errors; keeping abstractions from persisting fixes it at the lowest cost | G5 |
| [SkillX: Automatically Constructing Skill Knowledge Bases for Agents](https://arxiv.org/abs/2604.04804) | 2026-04 | 89 | Hierarchical skill knowledge bases improve success and efficiency of weaker agents | G4 |
| [CoEvoSkills: Self-Evolving Agent Skills via Co-Evolutionary Verificati…](https://arxiv.org/abs/2604.01687) | 2026-04 | 150 | Skills refined against a co-evolving verifier beat baselines on Claude Code and Codex | G5 |
| [AutoSkill: Experience-Driven Lifelong Learning via Skill Self-Evolutio…](https://arxiv.org/abs/2603.01145) | 2026-03 | 137 | AutoSkill: turns repeated user preferences into explicit, composable skills | G1 |
| [SoK: Agentic Skills -- Beyond Tool Use in LLM Agents](https://arxiv.org/abs/2602.20867) | 2026-02 | 147 | SoK on agent skills: curated skills raise success, **self-generated skills can degrade it**; skills are a supply-chain risk | G5 |
| [Skill-Pro: Learning Reusable Skills from Experience via Non-Parametric…](https://arxiv.org/abs/2602.01869) | 2026-02 | 65 | Skill-Pro: skills learned from experience with high reuse and extreme memory compression | G1 |
| [Remember Me, Refine Me: A Dynamic Procedural Memory Framework for Expe…](https://arxiv.org/abs/2512.10696) | 2025-12 | 79 | Dynamic procedural memory lets an 8B model beat a memoryless 14B one | G4 |
| [Evo-Memory: Benchmarking LLM Agent Test-time Learning with Self-Evolvi…](https://arxiv.org/abs/2511.20857) | 2025-11 | 154 | Evo-Memory benchmark: retrieving prior experience (ExpRAG) is a strong baseline for test-time learning | G1 |
| [Memp: Exploring Agent Procedural Memory](https://arxiv.org/abs/2508.06433) | 2025-08 | 105 | Procedural memory built by a strong model **transfers to a weaker model** with substantial gains | G4 |
| [SWE-Exp: Experience-Driven Software Issue Resolution](https://arxiv.org/abs/2507.23361) | 2025-07 | 83 | Experience bank of past repair trajectories: 73 % on SWE-bench Verified (Claude 4 Sonnet) | G1 |
| [Agent Workflow Memory](https://arxiv.org/abs/2409.07429) | 2024-09 | 469 | Agent Workflow Memory: induced reusable workflows raised success 24.6–51.1 % and cut steps on web tasks | G1 |
| [Voyager: An Open-Ended Embodied Agent with Large Language Models](https://arxiv.org/abs/2305.16291) | 2023-05 | 2829 | Voyager: an ever-growing library of verified code skills lets an agent reuse and compose behaviour in new worlds | G1 |

## Estimating spend (2)

| Paper | Date | Cites | Finding | Card |
|---|---|---|---|---|
| [How Much is Left? LLMs Linearly Encode Their Remaining Output Length](https://arxiv.org/abs/2607.05316) | 2026-07 | 2 | Models linearly encode how much output remains (decodable from hidden states) | B5 |
| [Robust Length Prediction: A Perspective from Heavy-Tailed Prompt-Condi…](https://arxiv.org/abs/2604.07931) | 2026-04 | 6 | Output length is heavy-tailed per prompt; predict a distribution, not a point | B5 |

## Batching (1)

| Paper | Date | Cites | Finding | Card |
|---|---|---|---|---|
| [Researchers waste 80% of LLM annotation costs by classifying one text …](https://arxiv.org/abs/2604.03684) | 2026-04 | 4 | Classifying 100 items per prompt instead of one stays within 2 points of accuracy at a fraction of the cost | F5 |
