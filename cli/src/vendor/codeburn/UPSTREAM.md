# Copied from codeburn

- Source: https://github.com/getagentseal/codeburn, `app/electron/quota/` (`claude.ts`, `security.ts`, `types.ts`)
- Upstream commit: `40d58800c13422d8681862482bab02380e42582f` (copied 2026-11-15)
- Licence: MIT, Copyright (c) 2026 AgentSeal (see `LICENSE` in this folder)

## Changes from upstream (keep this list short, so the monthly diff stays readable)

1. Import paths end in `.js` (Chompyy builds as NodeNext ESM).
2. `claude.ts` `planLabel`: `readable[0]!` for `noUncheckedIndexedAccess`.
3. `claude.ts` `request`: User-Agent is `chompyy/0.1 (...)` instead of `claude-code/2.1.0`, so requests say who is asking.

Chompyy's own code that uses this lives in `src/livequota.ts`.

## Prices (`prices.ts`, added 2026-11-21)

- Source: codeburn `src/data/litellm-snapshot.json` at commit `c08d761` (itself LiteLLM's `model_prices_and_context_window.json`), only the `claude-*` rows. Pricing rules follow codeburn `src/models.ts` `calculateCost`: missing cache rates = 1.25× / 0.1× input; a 1-hour cache write = 1.6× the 5-minute rate; the long-context tier applies to the whole call when its prompt is over the threshold.
- Chompyy's own code: `src/usage.ts`. Refresh by regenerating `prices.ts` from a newer snapshot.
