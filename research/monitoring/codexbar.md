# CodexBar: the macOS menu bar, from the code

- Repo: https://github.com/steipete/CodexBar · commit `8c0541ec4989d431710b256c80945013544b91c5` (2026-11-20) · **MIT** (Copyright (c) 2026 Peter Steinberger)
- Swift, macOS 14+, Swift Charts in 8 app files.
- Read: `Sources/CodexBar/{QuotaBurndownModel, AdaptiveRefreshPolicy, AutomaticQuotaSelection, MergedIconPresentation, PredictivePaceWarnings, LimitResetNotifications, HistoricalUsagePace}.swift`, `Sources/AdaptiveRefreshCore/AdaptiveRefreshPolicyCore.swift`, `Sources/CodexBarCore/UsagePace.swift`, `Sources/CodexBarCore/Providers/Claude/{ClaudeUsageDataSource, ClaudeSourcePlanner, ClaudeOAuth/ClaudeOAuthUsageFetcher, ClaudeWeb/ClaudeWebAPIFetcher}.swift`, `Sources/CodexBarCore/Vendored/CostUsage/{CostUsageScanner+Claude, ModelsDevPricing}.swift`, file list of `Menu/`, `StatusItem/`, `SpendDashboard/`. Not read line by line: the 100+ other providers, the ~50 `StatusItemController+*` extensions (menu plumbing), widgets.

## How it reads Claude usage

Data source enum (`ClaudeUsageDataSource.swift`): `auto`, `api` (Admin key), `oauth`, `web` (claude.ai cookies), `cli` (PTY).

Order in the app's Auto mode (`ClaudeSourcePlanner.swift:177`): **OAuth → CLI → Web**.

| Source | How | File |
|---|---|---|
| OAuth | `GET https://api.anthropic.com/api/oauth/usage` with Claude Code's token and an `anthropic-beta` header; decodes `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet`, `seven_day_oauth_apps`, routines, cowork | `ClaudeOAuth/ClaudeOAuthUsageFetcher.swift:61-64, 303-314` |
| CLI | Runs `claude` in a PTY with `--strict-mcp-config` and types `/usage`, then parses the screen | `ClaudeCLISession.swift`, `ClaudeUsageFetcher.swift:1191` |
| Web | `claude.ai/api/organizations/{org}/usage` with browser cookies; also prepaid credits | `ClaudeWeb/ClaudeWebAPIFetcher.swift:111-115` |

Same undocumented endpoint Chompyy already uses (via codeburn). Lots of Keychain consent and rate-limit gating code around it (`ClaudeOAuthKeychain*`, `ClaudeOAuthUsageRateLimitGate`).

## Local cost scan (Claude JSONL)

- Vendored scanner `Vendored/CostUsage/CostUsageScanner+Claude.swift`.
- **Dedupe key** (`:304`): `(message.id, requestId)`; if `requestId` is missing (proxies), `(sessionId, message.id)`; no id → kept as-is. A row replaces the stored one unless it is marked incomplete and the stored one isn't (`shouldReplaceClaudeRow`).
- Subagent files recognised by `/subagents/` in the path; Vertex ids (`_vrtx_`) flagged.
- 1h cache writes read from `cache_creation.ephemeral_1h_input_tokens`.
- **Pricing**: **models.dev** catalog (`https://models.dev/api.json`, `ModelsDevPricing.swift:674`) with a bundled fallback table and overrides (`CostUsagePricing.swift`). Results kept in a SQLite store with retention.

## The menu

| Piece | What it shows | File |
|---|---|---|
| Menu card per provider | Session / weekly / monthly bars with % and reset time, plan, account | `Menu/MenuCardView*.swift`, `Menu/UsageProgressBar.swift`, `Menu/MenuUsageBarStrip.swift` |
| **Quota burndown** | Remaining % over the window from recorded snapshots, plus the **ideal straight line** from 100 % at window start to 0 % at reset. Samples restart after a drop (a reset). | `QuotaBurndownModel.swift` (74 lines), `Menu/QuotaBurndownChartMenuView.swift` |
| Plan utilisation history | Past windows' peak use | `Menu/PlanUtilizationHistoryChartMenuView.swift`, `PlanUtilizationHistoryStore.swift` |
| Cost history | Daily cost bars with hover | `Menu/CostHistoryChartMenuView.swift` |
| Usage breakdown | By model / service | `Menu/UsageBreakdownChartMenuView.swift` |
| Tokens sparkline in the menu bar | Per-minute tokens; "a column keeps its peak rather than hiding brief bursts" | `Menu/MenuBarTokensSparkline.swift` (50 lines) |
| Spend dashboard window | Daily / weekly / cumulative **activity heatmap**, trend panel, model ranking, per-session performance and tool activity | `SpendDashboard/*.swift` |

## Switching providers

- **Merge Icons**: one status item for many providers. Style `switcher` (row of toggle buttons in the menu, `Menu/ProviderSwitcherButtons.swift`) or `stacked` (two providers' percentages in one icon, top and bottom). Logic in `MergedIconPresentation.swift` (59 lines): stacking needs merge on, icon+percent style and ≥ 2 providers.
- **Auto / highest usage**: `AutomaticQuotaSelection.swift` picks the window to show by pace and ETA across session/weekly/tertiary.
- Menu bar layout editor: users choose which metric per line (`Menu/MenuBarLayout*.swift`).

## Refresh cadence

`AdaptiveRefreshPolicyCore.swift:53-63`, pure function of (last menu open, last coding activity, low power, thermal):

| Situation | Delay |
|---|---|
| Menu opened in the last 5 min | 2 min |
| Coding activity in the last 5 min | ≤ 5 min |
| Warm (menu used in the last hour) | 5 min |
| Idle (< 4 h) | 15 min |
| Long idle / low power / thermal pressure | 30 min |

Plus fixed 1–30 min options and a refresh on menu open.

## Pace and notifications

- `UsagePace.swift`: expected % from elapsed time (optionally only **work days**), delta, ETA to 100 %, `willLastToReset`, a speed multiplier.
- `HistoricalUsagePace.swift`: learns the usual shape of your week from 8 weeks of samples (169 grid points, 30 min writes) to predict run-out probability (Codex weekly only today).
- `PredictivePaceWarnings.swift`: notify once per window when ETA < reset and run-out probability ≥ 0.5; re-arm when the pace recovers.
- `LimitResetNotifications.swift`: "your limit reset" and "restored" notices, keyed by reset boundary so they fire once.

## What to port to Chompyy's Swift app

1. **`QuotaBurndownModel` + its chart**: the even-use line is our stay-on-pace rule drawn. Feed it from `~/.chompyy/quota-history.json`.
2. **`AdaptiveRefreshPolicyCore`** numbers (pure, tiny) for how often the app runs `chompyy state`.
3. **`MergedIconPresentation`** switcher vs stacked, for Claude + Codex in one cookie.
4. **`MenuBarTokensSparkline`** peak-per-column rule.
5. **Notification once-per-boundary keys** from `LimitResetNotifications` / `PredictivePaceWarnings`; flip the wording to "will reset unused".
6. Don't port: CLI PTY scraping and cookie import (trust cost); the SQLite cost store (codeburn's TS path covers spend).
