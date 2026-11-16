# Copied from codeburn

- Source: https://github.com/getagentseal/codeburn, `app/electron/quota/` (`claude.ts`, `security.ts`, `types.ts`)
- Upstream commit: `40d58800c13422d8681862482bab02380e42582f` (copied 2026-11-15)
- Licence: MIT, Copyright (c) 2026 AgentSeal (see `LICENSE` in this folder)

## Changes from upstream (keep this list short, so the monthly diff stays readable)

1. Import paths end in `.js` (Chompyy builds as NodeNext ESM).
2. `claude.ts` `planLabel`: `readable[0]!` for `noUncheckedIndexedAccess`.
3. `claude.ts` `request`: User-Agent is `chompyy/0.1 (...)` instead of `claude-code/2.1.0`, so requests say who is asking.

Chompyy's own code that uses this lives in `src/livequota.ts`.
