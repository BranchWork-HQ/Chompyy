// User settings: ~/.chompyy/config.json, merged over these defaults.
import { homePath, readJson } from './home.js';

export interface Config {
  /** Path or name of the Claude Code binary. */
  claudeBin: string;
  /** Cheap model that drafts blueprints. */
  blueprintModel: string;
  /** Model for away runs; null = Claude Code's default. */
  runModel: string | null;
  /** Hard wall-clock limit per card, in minutes (also capped by the time left in the away run). */
  cardTimeoutMin: number;
  /** Passed as --max-turns when set (accepted by claude 2.1.322 though not listed in --help); null = no cap. */
  maxTurns: number | null;
  /** Don't start a card when the 5h window has less than this % left. */
  min5hLeftPct: number;
  /** Hard stop: never run when weekly used % > 100 - this. */
  weeklyReservePct: number;
  /** Only run while weekly usage is behind an even pace (used % ≤ % of the week gone). */
  weeklyPace: boolean;
  /** --permission-mode for away runs. acceptEdits = file edits allowed, other tools need allowedTools. */
  permissionMode: string | null;
  /** --permission-prompts for away runs; "none" denies anything that would prompt instead of hanging. */
  permissionPrompts: string | null;
  allowedTools: string[];
  disallowedTools: string[];
  /** Run away cards in Claude Code's OS sandbox: shell writes only in the card's folder, network off. */
  sandbox: boolean;
  /** Domains sandboxed commands may reach (e.g. "registry.npmjs.org"). Empty = no network. */
  sandboxAllowedDomains: string[];
  /** Appended verbatim to every away-run `claude -p` call. */
  extraArgs: string[];
}

export const DEFAULT_CONFIG: Config = {
  claudeBin: 'claude',
  blueprintModel: 'haiku',
  runModel: null,
  cardTimeoutMin: 30,
  maxTurns: 50,
  min5hLeftPct: 10,
  weeklyReservePct: 10,
  weeklyPace: true,
  permissionMode: 'acceptEdits',
  permissionPrompts: 'none',
  allowedTools: [
    'Read',
    'Glob',
    'Grep',
    'WebSearch',
    'WebFetch',
    'Bash(ls *)',
    'Bash(git status *)',
    'Bash(git diff *)',
    'Bash(git log *)',
    'Bash(git add *)',
    'Bash(git commit *)',
    'Bash(npm test *)',
    'Bash(npm run *)',
    'Bash(npx vitest *)',
    'Bash(pytest *)',
  ],
  disallowedTools: [
    'Bash(git push *)',
    'Bash(git merge *)',
    'Bash(git rebase *)',
    'Bash(git reset *)',
    'Bash(git checkout *)',
    'Bash(git switch *)',
    'Bash(git worktree *)',
    'Bash(gh *)',
    'Bash(npm publish *)',
    'Bash(curl *)',
    'Bash(rm -rf *)',
  ],
  sandbox: true,
  sandboxAllowedDomains: [],
  extraArgs: [],
};

export function configPath(): string {
  return homePath('config.json');
}

export function loadConfig(): Config {
  return { ...DEFAULT_CONFIG, ...readJson<Partial<Config>>(configPath(), {}) };
}
