// User settings: ~/.chompyy/config.json, merged over these defaults.
import { homePath, readJson, writeJson } from './home.js';

export interface Config {
  /** Path or name of the Claude Code binary. */
  claudeBin: string;
  /** Cheap model that drafts blueprints. */
  blueprintModel: string;
  /** Model that reads your history once for the cold start. */
  coldStartModel: string;
  /** `chompyy suggest`: tasks from a repo's docs, issues and code. */
  suggestModel: string;
  /** Draw a picture (diagram) for every card after its blueprint. */
  pictures: boolean;
  /** Model that draws card pictures with the diagram-design skill. */
  pictureModel: string;
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
  /**
   * WebSearch and WebFetch in away runs. Off by default: they don't go through the sandbox's network block, so a run
   * tricked by text in the repo could send what it read out in a URL (#24). Blueprints keep them.
   */
  awayWeb: boolean;
  disallowedTools: string[];
  /** Run away cards in Claude Code's OS sandbox: shell writes only in the card's folder, network off. */
  sandbox: boolean;
  /** Never readable by away runs: blocked for shell commands (sandbox) and for the Read, Grep and Glob tools. */
  denyReadPaths: string[];
  /** Run the repo's own tests after each card, outside the agent, in a sandbox (macOS). */
  independentCheck: boolean;
  /** Time limit for the independent check, in minutes. */
  checkTimeoutMin: number;
  /** Test command per repo, when the detected one is wrong: { "/path/to/repo": "npm run test:unit" }. */
  checkCommands: Record<string, string>;
  /** Stop a card that repeats the same tool call this many times (circuit breaker); 0 = off. */
  loopRepeat: number;
  /** Stop a card whose agent prints nothing for this many minutes, and move on to the next; 0 = off. */
  idleTimeoutMin: number;
  /** Stop a card after the sandbox or permissions blocked it this many times; 0 = off. */
  maxDenied: number;
  /** Suggested cards you haven't touched for this many days are archived; 0 = never. */
  suggestedExpiryDays: number;
  /** Domains sandboxed commands may reach (e.g. "registry.npmjs.org"). Empty = no network. */
  sandboxAllowedDomains: string[];
  /** Where quota comes from: Anthropic's usage endpoint with Claude Code's saved login ("api"), or only the status line. */
  quotaSource: 'api' | 'statusline';
  /**
   * May the quota check read Claude Code's saved login from the macOS Keychain? null = not asked yet: no Keychain
   * read until you allow it (`chompyy quota --allow-keychain`, or Allow in the app). #24: a tester wanted an opt-in
   * rather than "choose Always Allow".
   */
  allowKeychain: boolean | null;
  /** Appended verbatim to every away-run `claude -p` call. */
  extraArgs: string[];
  /** Model that distils taste from your signals (a stronger model: it runs rarely and decides what gets asked). */
  distillModel: string;
  /** Distil taste after an away run when there are new signals (uses the window that is already active). */
  distillAfterAway: boolean;
  /** The nightly read: learn from your everyday coding sessions in the workspaces you ticked (dream.ts). */
  dream: boolean;
  /** Your plan's monthly price in USD, for "your plan did N× its price"; null = list price for the plan Chompyy sees. */
  planPriceUsd: number | null;
  /** Model for the nightly read. Opus found the most specific rules for the same tokens (research/nightly-read/). */
  dreamModel: string;
  /** Trigger: run approved cards in the last hour before a 5-hour reset (needs `chompyy triggers on`). */
  lastHourTrigger: boolean;
  /** Last-hour trigger fires only with at least this % of the window left. */
  lastHourMinLeftPct: number;
  /** Trigger: your bedtime as "23:30" local time; null = off (needs `chompyy triggers on`). */
  bedtime: string | null;
  /** How long after bedtime the trigger may still start, in minutes. */
  bedtimeWindowMin: number;
  /** Trigger: run approved cards on the first tick after a 5-hour reset nothing used (off by default; needs `chompyy triggers on`). */
  missedReset: boolean;
}

export const DEFAULT_CONFIG: Config = {
  claudeBin: 'claude',
  blueprintModel: 'haiku',
  coldStartModel: 'sonnet',
  suggestModel: 'sonnet',
  pictures: true,
  pictureModel: 'sonnet',
  runModel: null,
  cardTimeoutMin: 30,
  maxTurns: 50,
  min5hLeftPct: 10,
  weeklyReservePct: 10,
  weeklyPace: true,
  permissionMode: 'acceptEdits',
  permissionPrompts: 'none',
  allowedTools: [
    'Bash(ls *)',
    'Bash(git status *)',
    'Bash(git diff *)',
    'Bash(git log *)',
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
  awayWeb: false,
  sandbox: true,
  sandboxAllowedDomains: [],
  denyReadPaths: [
    '~/.ssh',
    '~/.aws',
    '~/.gnupg',
    '~/.config/gh',
    '~/.config/gcloud',
    '~/.azure',
    '~/.kube',
    '~/.docker',
    '~/.netrc',
    '~/.npmrc',
    '~/.pypirc',
    '~/.git-credentials',
    '~/.claude/.credentials.json',
    '~/Library/Keychains',
  ],
  independentCheck: true,
  checkTimeoutMin: 10,
  checkCommands: {},
  loopRepeat: 5,
  idleTimeoutMin: 15,
  maxDenied: 300,
  suggestedExpiryDays: 14,
  quotaSource: 'api',
  allowKeychain: null,
  extraArgs: [],
  distillModel: 'sonnet',
  distillAfterAway: true,
  dream: true,
  dreamModel: 'opus',
  planPriceUsd: null,
  lastHourTrigger: true,
  lastHourMinLeftPct: 25,
  bedtime: null,
  bedtimeWindowMin: 60,
  missedReset: false,
};

export function configPath(): string {
  return homePath('config.json');
}

export function loadConfig(): Config {
  return { ...DEFAULT_CONFIG, ...readJson<Partial<Config>>(configPath(), {}) };
}

/** Change one setting in config.json, keeping the rest of what you set. */
export function setConfig<K extends keyof Config>(key: K, value: Config[K]): void {
  writeJson(configPath(), { ...readJson<Partial<Config>>(configPath(), {}), [key]: value });
}
