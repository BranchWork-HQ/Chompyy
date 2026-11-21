# sniffly: per-project dashboard and error analysis

- Repo: https://github.com/chiphuyen/sniffly · commit `a237d7e9a9b37181626c049046c99b496f6c33c5` (2025-08-08, quiet since) · **MIT** (Copyright (c) 2025 Chip Huyen) · 1.3k ⭐
- Python server + Chart.js page. Read: `sniffly/core/{processor.py, stats.py, constants.py}`, `sniffly/utils/pricing.py`, `sniffly/services/pricing_service.py`, `sniffly/static/js/charts.js` header.

## What it does

| Feature | Where | How |
|---|---|---|
| **Error categories** | `core/constants.py:25-75`, `core/stats.py:455` | Regexes over tool-result error text, first match wins: User Interruption, Command Timeout, File Not Read, File Modified, File Too Large, Content Not Found, No Changes, Permission Error, Tool Not Found, Wrong Tool, Code Runtime Error, Port Binding Error, Syntax Error, Other |
| Error rate over time | `stats.py:494` | Each assistant message flagged if the next message is an error |
| **Interruption rate** | `stats.py:262-410, 576` | Per user command: followed by a user interruption or an API error? Daily %. |
| Command complexity | `stats.py` `_analyze_user_interactions` | Tools and steps per user command, over time |
| Hourly pattern | `stats.py:412` | Tokens by hour of day (timezone-adjusted) |
| Charts | `static/js/charts.js:9-21` | Tokens over 30 days, daily cost, tool usage, tokens by hour, user interactions, model usage, error distribution, command complexity over time, tool trends |
| Message browser | `static/js/messages-tab.js`, `jsonl-viewer.js` | Read the raw conversation |
| Share | `share.py` | Publish a stats card (opt-in) |

## Weak spots

- Streaming merge (`processor.py:834`, `_merge_message_group` `:600`) groups by `message.id` and merges tools and text, but **tokens come from the first row** (the docstring says "sums"; the code copies `group[0]` and never touches usage).
- Pricing: LiteLLM URL with a hard-coded fallback; no 1-hour cache price.
- One project at a time; no cost per turn.

## What to copy

1. **The error category regexes** (MIT, ~50 lines) for tool-step badges in the trace view and for the detective's "error loop" input.
2. **Interruption rate** per conversation: a cheap "this conversation went badly" signal next to its cost. Also useful for taste (you stopped the agent here).
3. Hour-of-day tokens as one input to the weekday × hour grid.
