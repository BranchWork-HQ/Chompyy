// The failure catalog (research/away-readiness.md, step 1): every known way the away box blocks real work,
// as a signature in the output → a cause in plain words → the kind of fix. Preflight only consults it after
// proving the failure is the box's (the check passes outside the box on the same code); it never decides alone.
// A new kind of failure gets an entry here and a scenario in the tests, never a one-off patch.

export type FixKind =
  /** Chompyy can fix it itself (point a cache into the box, clone dependencies). */
  | 'auto'
  /** Needs your permission at the approval stage (run outside the box, allow a domain). */
  | 'permission'
  /** The repo itself should change (a test writing outside the project). */
  | 'repo';

export interface CatalogEntry {
  id: string;
  /** What happened, for you. */
  title: string;
  /** Signs of it in the output. */
  match: RegExp;
  /** Why the box causes it. */
  cause: string;
  fix: FixKind;
  /** What to do about it. */
  remedy: string;
}

export const CATALOG: CatalogEntry[] = [
  {
    id: 'nested-sandbox',
    title: 'The tool tries to start its own sandbox',
    match: /sandbox_apply|sandbox-exec: .*Operation not permitted|unable to (?:create|apply) sandbox|failed to (?:create|apply) (?:the )?sandbox/i,
    cause: "macOS doesn't allow a sandbox inside a sandbox; tools like SwiftPM sandbox their own build steps.",
    fix: 'auto',
    remedy: 'Turn the tool\'s own sandbox off (the away box already sandboxes it): Chompyy runs `swift build --disable-sandbox` with its caches inside the box.',
  },
  {
    id: 'tool-cache-outside',
    title: 'The tool writes its cache outside the project',
    match: /org\.swift\.swiftpm|ModuleCache|clang[\\/]ModuleCache|\.swiftpm[\\/]|go-build|Library[\\/]Caches|is not accessible|\.cache[\\/].*(?:EACCES|EPERM|denied)/i,
    cause: 'Build tools keep caches in your home folder (~/Library/Caches, ~/.cache), which the box can\'t write.',
    fix: 'auto',
    remedy: 'Chompyy points the tool\'s caches at a folder inside the box.',
  },
  {
    id: 'writes-home',
    title: 'A test writes to your home folder',
    match: /(?:EPERM|EACCES|Operation not permitted|permission denied)[^\n]*(?:\/Users\/[^/\s]+\/(?!Library\/Caches)|\$HOME|homedir)|mkdtemp[^\n]*\/Users\//i,
    cause: 'The test creates files directly in your home folder; the box only allows writes in the project and temp folders.',
    fix: 'repo',
    remedy: 'Make the test use a temp folder (`os.tmpdir()`), which works everywhere and leaves nothing behind.',
  },
  {
    id: 'temp-outside',
    title: "The tool can't save through the system temp folder",
    match: /You don.t have permission to save the file|error: permissionDenied/i,
    cause: 'macOS tools save files safely by writing a temp copy in your per-user temp folder (/private/var/folders/…) first; a box that blocks it breaks the save (swift build, 2026-11-18).',
    fix: 'auto',
    remedy: "Every box allows the same temp folders (boxTempDirs): the agent's sandbox and Chompyy's own check.",
  },
  {
    id: 'runner-reply-timeout',
    title: 'The test runner timed out talking to its worker',
    match: /Timeout calling "?on\w+"?/i,
    cause: 'Tests that block the worker (synchronous git or shell calls) for over 60 s in one file starve Vitest\'s reply channel; every test passes but the run fails.',
    fix: 'repo',
    remedy: 'Give the worker a pause after each test (a setup file with `afterEach(() => new Promise((r) => setImmediate(r)))`), or make the slow calls async.',
  },
  {
    id: 'network',
    title: 'It needs the network',
    match: /ENOTFOUND|EAI_AGAIN|getaddrinfo|Could not resolve host|network is unreachable|ECONNREFUSED|Failed to fetch|unable to access 'https?:/i,
    cause: 'The box has no network for shell commands (package downloads, API calls).',
    fix: 'permission',
    remedy: 'Install dependencies before the box closes (Chompyy\'s setup step), or allow the domain on the blueprint.',
  },
  {
    id: 'missing-deps',
    title: 'Dependencies are missing',
    match: /Cannot find module|ERR_MODULE_NOT_FOUND|command not found: (?:vitest|jest|tsc|eslint)|(?:vitest|jest|tsc|eslint): (?:command )?not found|No module named/i,
    cause: 'A fresh copy of the repo has no installed packages, and the box can\'t download them.',
    fix: 'auto',
    remedy: 'Chompyy clones your installed packages into the copy (instant, no download).',
  },
  {
    id: 'needs-approval',
    title: 'It needed an approval nobody could give',
    match: /no approval surface|requires approval|permission request denied automatically/i,
    cause: 'Away runs are unattended, so anything that asks for approval is refused.',
    fix: 'permission',
    remedy: 'Chompyy lists it on the blueprint so you can allow it when you approve the card.',
  },
];

export interface Diagnosis {
  entry: CatalogEntry;
  /** The line that matched, as evidence. */
  evidence: string;
}

/** Which known box failures this output shows, most specific first, each with the line that matched. */
export function diagnose(output: string): Diagnosis[] {
  const lines = output.split('\n');
  const found: Diagnosis[] = [];
  for (const entry of CATALOG) {
    const line = lines.find((l) => entry.match.test(l));
    if (line) found.push({ entry, evidence: line.trim().slice(0, 240) });
  }
  return found;
}
