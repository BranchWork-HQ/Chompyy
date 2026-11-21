# AgentLimits: widgets, heatmap, pacemaker and wake-up

- Repo: https://github.com/Nihondo/AgentLimits · commit `bcc780d431301ddc2265ef9283e51d9d006f2c3c` (2026-10-31) · **MIT** (Copyright (c) 2025 Nihondo) · 72 ⭐, Swift
- Read: `AgentLimitsWidget/{HeatmapView, HeatmapLevelResolver, HeatmapColors}.swift`, `AgentLimits/CCUsage/CCUsageFetcher.swift`, `AgentLimits/Usage/ClaudeUsageFetcher.swift` (grep), `AgentLimits/WakeUp/WakeUpScheduler.swift` header, `AgentLimits/Pacemaker/PacemakerSettingsView.swift`, file list.

## The heatmap

**Correction for FEATURES.md**: it is a **GitHub-style calendar** (7 rows Sun–Sat × 5–6 week columns, one month), **not weekday × hour**.

| Part | File | How |
|---|---|---|
| Data | `CCUsageFetcher.swift` | Runs the user's **`ccusage daily -j`** (and `ccusage codex daily -j`) and maps each day's `totalTokens` to an ISO date. Needs ccusage installed. |
| Levels | `HeatmapLevelResolver.swift` (69 lines) | Drop zero days; take **quartiles** (25/50/75 %) of the non-zero days; level 0 = no use, 1–4 = which quartile. So colour is relative to *your* month, not an absolute scale. |
| Colours | `HeatmapColors.swift` | GitHub's dark greens (`#151b23`, `#033a16`, `#196c2e`, `#2ea043`, `#56d364`); in the "accented" desktop widget mode, white at opacity 0.1/0.3/0.5/0.7/0.9 |
| View | `HeatmapView.swift` (150 lines) | Rounded squares, spacing and corner = 0.2 × cell size, labels only Mon/Wed/Fri, WidgetKit rendering-mode aware |

A weekday × hour grid (what Chompyy wants for "propose away windows") exists in codeburn's Electron `Punchcard.tsx` and in sniffly's hourly chart, not here.

## Other pieces

- **Limits**: Claude from `claude.ai/api/organizations/{org}/usage` run inside a WKWebView with the user's claude.ai login (`ClaudeUsageFetcher.swift:245`). Ring gauges (`UsageRingGaugeView.swift`) in widgets; linear bars in the menu (`MenuBar/UsageLinearBarView.swift`).
- **Pacemaker**: a second marker on the ring showing elapsed time in the window, so "used vs time passed" reads at a glance; optional warning colour when ahead of pace.
- **Threshold notifications** (`Notification/`), per provider and window.
- **Wake-up** (`WakeUp/WakeUpScheduler.swift`): writes LaunchAgents that run the CLI at chosen hours to **start a 5-hour window on purpose** (e.g. `--model=haiku`). Chompyy's rule is never to start a window by probing; this is the opposite, a deliberate "prime the window before you sit down". ⚠️ Check provider terms before ever offering it.
- **Custom usage**: user scripts that print usage JSON for any service.

## What to copy

1. **Quartile levels + the 5 colours + cell geometry** for the daily calendar in the menu (≈ 220 lines of SwiftUI, MIT). Feed it from Chompyy's own daily totals, not by calling ccusage.
2. **Pacemaker marker** on our 5-hour and weekly bars (same idea as CodexBar's even-use line, smaller).
3. Note the wake-up idea in open questions; don't build without a terms check.
