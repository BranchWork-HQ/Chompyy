# Foundation: what codeburn and CodexBar do, and which language each part is in

Decided 2026-11-14: Chompyy **copies or ports** code from both projects (MIT), with credit, instead of asking users to install them. This page lists what each one does, so we can choose what to take and whether it belongs on the TypeScript or the Swift side.

Sources: each project's README and source tree on 2026-11-14 ([codeburn](https://github.com/getagentseal/codeburn), 11.8k ⭐; [CodexBar](https://github.com/steipete/CodexBar), 23.2k ⭐). Features as described there; code not read in depth.

## The short answer

**Lean TypeScript for the core and Swift for the Mac app. That's the same split codeburn already uses.**

- **codeburn's brain is TypeScript** (`src/`, \~100 modules, 49 provider readers). Chompyy's core is TypeScript too, so its spend tracking, readers, optimize, guard and compare can be **copied almost directly**.
- **CodexBar is Swift almost everywhere** (app, CLI and core logic). Its **Mac UI pieces** (menus, burndown charts, widgets, notifications) fit Chompyy's **Swift** menu bar directly. Its **provider limit readers** are Swift logic, so they'd be **ported** to TypeScript one at a time, starting with the ones we need.

### Why not Swift for the limit readers too? (answering thought 1)

Two different jobs, easy to mix up:

| | **Spend / session readers** (codeburn) | **Limit readers** (CodexBar, and codeburn too) |
|---|---|---|
| Question it answers | What already happened: tokens and cost by project, branch, task | How much plan is left right now, and when it resets |
| Where the data comes from | Session files on disk (`~/.claude/projects/*.jsonl`, …) | The provider's usage endpoint, using your existing login, or Claude Code's status line |
| What Chompyy uses it for | Cold start, taste, cost ranges, optimize, trends | The gate: may an away card start now? |

**Why the limit readers belong in the TypeScript core, not Swift:** the gate decides whether to spend your quota, so it has to work wherever away runs happen: from the CLI, from `/away` inside an agent, on Linux or WSL2, or later on GitHub Actions. None of those have the Mac app running. If limits lived only in Swift, the Mac app would become required and the core couldn't check limits without it. The Mac app still *shows* everything; it just asks the core.

**Good news, found 2026-11-15:** codeburn already has limit readers **in TypeScript** in `app/electron/quota/`: Claude, Codex, Copilot, Gemini, Kimi, Antigravity and more. So for most of the first five we **copy** TS instead of porting Swift. Only Cursor (and anything else codeburn lacks) needs porting from CodexBar.

⚠️ **One catch to decide on:** codeburn's Claude reader takes Claude Code's login from the macOS Keychain (a permission prompt) and calls `api.anthropic.com/api/oauth/usage`, an endpoint Anthropic doesn't document. It sends no message, so it doesn't start a window, and it works without a live session, which our status-line reader can't do. But it's undocumented and reuses Claude Code's login. **Proposal:** keep the documented status line as the default; offer the usage endpoint as an opt-in, after checking provider terms. CodexBar likely works the same way (not checked).

```
 ┌─ Swift (macOS app) ────────────────────────────────────────────────────────────┐
 │  menu bar · popover · widgets · notifications · charts                         │
 │  ← take from CodexBar's app UI and codeburn's mac/ (both Swift)                │
 └───────────────────────────────┬────────────────────────────────────────────────┘
                                 │ calls
 ┌─ TypeScript (chompyy core + CLI) ──────────────────────────────────────────────┐
 │  spend · 42 session readers · optimize · guard · compare   ← copy from codeburn │
 │  limits for Claude, Codex, Copilot, Gemini ← copy codeburn; Cursor ← port CodexBar │
 │  board · blueprints · away runs · report · taste          ← Chompyy's own      │
 └────────────────────────────────────────────────────────────────────────────────┘
```

## codeburn: features and languages

Shape: a **TypeScript CLI** (`src/`) that everything else calls, plus thin native shells: a Swift menu bar (`mac/`), a desktop app (Electron: `app/electron/`, which also holds the TypeScript limit readers), a GNOME extension (`gnome/`), Windows (`windows/`) and a VS Code extension (`vscode/`).


| Feature                                      | What it does                                                                                                                                                    | Language            | Take for Chompyy?                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------- |
| **Session readers for 42 tools**             | Auto-detects installed tools and reads their sessions from disk; one file per tool (`src/providers/`, 49 files); documents each tool's data location and quirks | TS                  | ✅ Copy. Also powers the history cold start for more agents |
| **Spend by project, branch, model, task**    | The same money cut four ways; the branch view gives the cost of a feature                                                                                       | TS                  | ✅ Copy                                                     |
| **Sessions → turns drill-down**              | Click a total → sessions → the turns inside, to see what was expensive                                                                                          | TS (+ UI)           | ✅ For the dashboard                                        |
| **Pull requests / Yield**                    | Matches spend to the PRs your sessions recorded: which spend shipped                                                                                            | TS                  | ✅ Later; pairs with card results                           |
| **Compare periods**                          | Two date ranges side by side, after you change a model, workflow or prompt                                                                                      | TS                  | ✅ The base for "checking our own claims"                   |
| **compare models** on your history           | Model vs model on your own sessions                                                                                                                             | TS (`compare*.ts`)  | ✅ Later                                                    |
| **optimize**                                 | Finds waste (files re-read every turn, unused MCP servers, an overlong `CLAUDE.md`), grades it, gives the fix and expected saving                               | TS                  | ✅ Optimization side                                        |
| **optimize --apply / act undo / act report** | Applies fixes with backups, undoes them, and days later checks what each fix promised against what happened                                                     | TS (`act/`)         | ✅ Same idea as keep/undo + paired replays                  |
| **plan + quota**                             | Set your subscription; `quota` reads live 5-hour and weekly limits from tools you're signed in to; month-on-pace                                                | TS                  | ✅ Compare with our status line reader                      |
| **guard**                                    | Claude Code hooks: warn at $5, stop at$15, stop looping tool calls and repeated failing commands                                                                | TS (`guard/`)       | ✅ Loop protection for away runs                            |
| **budget**                                   | Spend budgets and checks                                                                                                                                        | TS                  | ◐ Less relevant on a flat plan                             |
| **context**                                  | Breakdown of what fills the context window per session                                                                                                          | TS (`context-*.ts`) | ✅ Optimization side                                        |
| **Pricing tools**                            | Currency, model aliases, price overrides and discounts, flat-rate models, proxy paths                                                                           | TS                  | ◐ Take flat-rate handling (subscriptions)                  |
| **export** CSV / JSON                        |                                                                                                                                                                 | TS                  | ✅                                                          |
| **MCP server + Claude Code plugin**          | Ask "where did my tokens go" from inside the agent; local only, project names pseudonymized                                                                     | TS (`mcp/`)         | ✅ Good pattern for `/eat-tokens`                           |
| **devices / share**                          | Combine usage across your devices, paired locally                                                                                                               | TS                  | 💭 Later                                                   |
| **Menu bar** (macOS)                         | Today's spend beside the clock; popover with period switcher, trend, per-model breakdown                                                                        | **Swift** (`mac/`)  | ✅ Reference for Chompyy's menu bar                         |
| **Capacity Dock**                            | A thin rail at a screen edge with one ring per provider showing how much plan is left                                                                           | Swift               | ✅ Strong fit: "what's left before you start"               |
| **Desktop app**, Windows, GNOME, VS Code     | Same data in other shells                                                                                                                                       | Rust/web, JS, TS    | Later                                                      |
| **Localization**                             | 6 languages incl. Traditional Chinese                                                                                                                           | Swift strings       | ✅                                                          |
| **Telemetry**                                | Opt-in-style usage events with bucketed values                                                                                                                  | TS                  | Decide our own policy                                      |


## CodexBar: features and languages

Shape: **Swift almost everywhere**. `Sources/` holds the app (`CodexBar`), the CLI (`CodexBarCLI`), the logic (`CodexBarCore`), a Claude watchdog and web probe, an adaptive refresh core, plus bundled SQLite and QuickJS (an embedded JavaScript engine, apparently for plugins). Also a WidgetKit extension and a Linux desktop app in Qt/QML.


| Feature                                                             | What it does                                                                                                                      | Language               | Take for Chompyy?                                                                                                        |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Limits for 114 providers**                                        | Session, weekly and monthly windows with reset countdowns (Claude, Codex, Cursor, Copilot, Gemini, Kimi, Windsurf, OpenRouter, …) | Swift (`CodexBarCore`) | ✅ **Port** the ones we need first: Claude, Codex, Cursor, Copilot, Gemini                                                |
| **How it reads them**                                               | Reuses existing logins: OAuth, CLI credentials, API keys, local files, **browser cookies** (opt-in), a CLI fallback               | Swift                  | ⚠️ Prefer OAuth and local files; browser cookies and Keychain access need Full Disk Access or prompts, which hurts trust |
| **Quota burn down with an even-use guide**                          | Chart from recorded snapshots, with a line showing even use through the window                                                    | Swift UI               | ✅ The visual for our stay-on-pace rule                                                                                   |
| **Upcoming-reset warnings for unused quota**                        | Notifies before a reset when quota would go unused                                                                                | Swift                  | ✅ **Exactly Chompyy's trigger**: offer cards at that moment                                                              |
| **Session quota notifications**; weekly-reset confetti              |                                                                                                                                   | Swift                  | ✅ Fun touch for the cookie                                                                                               |
| **Cost scans** for Codex and Claude; spend charts for API providers | Local cost estimates, SQLite history store with caps                                                                              | Swift                  | ◐ codeburn covers spend better (and in TS)                                                                               |
| **Provider status polling**                                         | Incident badges in the menu and on the icon                                                                                       | Swift                  | ✅ Don't start away cards during an outage                                                                                |
| **Adaptive refresh**                                                | Refresh rate adapts; fixed 1–30 min options                                                                                       | Swift                  | ✅ For the menu bar                                                                                                       |
| **Merge Icons mode**                                                | Many providers in one menu bar item with a switcher                                                                               | Swift                  | ✅ One compact cookie icon                                                                                                |
| **Display controls**                                                | Icons, labels, bars, reset-time style, highest-usage auto-select                                                                  | Swift                  | ✅                                                                                                                        |
| **WidgetKit widgets**                                               | Desktop and Notification Center widgets                                                                                           | Swift                  | ✅ Wanted (see below)                                                                                                    |
| **CLI** (`codexbar`)                                                | Scripts and CI, incl. `codexbar cost`                                                                                             | Swift                  | Reference only (we have our own CLI)                                                                                     |
| **Localization**                                                    | 23 languages, right-to-left support                                                                                               | Swift strings          | ✅                                                                                                                        |
| **Sparkle updates**                                                 | Self-update for the Mac app                                                                                                       | Swift                  | ✅ For shipping the Mac app                                                                                               |
| **Linux desktop app**                                               | Usage and spend windows, notifications, tray                                                                                      | Qt / QML               | Later                                                                                                                    |
| **Plugins**                                                         | Bundled plugins (e.g. Charm Hyper) on an embedded JS engine                                                                       | Swift + JS             | 💭 Possible plugin route later                                                                                           |


**WidgetKit widgets: wanted** (2026-11-15). A desktop widget with the cookie and what's left fits "glance, don't open". Now planned in FEATURES.md §9.

## Where they overlap


| Capability                    | codeburn                               | CodexBar                              | Take from                                          |
| ----------------------------- | -------------------------------------- | ------------------------------------- | -------------------------------------------------- |
| Live limits                   | `quota`, TS readers for ~8 providers   | 114 providers, deeper (Swift)         | codeburn (copy) first; CodexBar (port) for the rest |
| Spend tracking                | By project, branch, task, PR, model    | Cost scans, API spend charts          | codeburn (copy)                                    |
| Menu bar                      | Spend popover + Capacity Dock          | Limits, burndown, merge mode, widgets | Both, in Swift                                     |
| Pacing                        | Month-on-pace                          | Even-use guide on the burndown        | Both ideas; our weekly gate already does the logic |
| Optimize, guard, compare, MCP | ✅                                      | —                                     | codeburn                                           |
| Reset notifications           | —                                      | ✅ incl. unused-quota warnings         | CodexBar                                           |
| Status / incidents            | —                                      | ✅                                     | CodexBar                                           |


## Ongoing cost: is calling their tools any cheaper?

Yes, calling them would also need watching, but **less**:


|                                       | Calling their CLIs                     | Copying their code (chosen)         |
| ------------------------------------- | -------------------------------------- | ----------------------------------- |
| A tool changes its file format or API | **They** fix it; users update the tool | **We** must notice and copy the fix |
| Their command output changes          | We fix our side                        | Not affected                        |
| New providers                         | Arrive for free                        | We port them if we want them        |
| Extra installs for users              | Yes (rejected)                         | None                                |


How to keep the copying cost down:

1. **Keep copied code in its own folder per source** (e.g. `cli/src/vendor/codeburn/`), each with the upstream commit it came from and a credit notice.
2. **A small script that diffs our copy against upstream** and lists what changed since, run monthly or before releases.
3. **Copy only what we use.** Start with the Claude Code, Codex and Cursor readers and limits, not all 42 and 114.
4. **Send fixes upstream** when we find bugs, so both projects benefit and the diff stays small.

## Credit

Both are MIT: keep each project's copyright and licence text with the copied code, list them in a `THIRD_PARTY_NOTICES` file, and credit them in the README.