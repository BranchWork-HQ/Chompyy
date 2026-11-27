# Security

Chompyy runs an AI agent on your code while you're away, so a hole in its safety box matters. Thank you for looking.

## Reporting a problem

Please report privately, not in a public issue:

- **[Report a vulnerability](https://github.com/BranchWork-HQ/Chompyy/security/advisories/new)** (GitHub's private reporting)

Include what you saw, the version (`npm ls -g chompyy`), and steps or the lines of code involved. A report from reading the code, without a working exploit, is welcome: that is how #24 started.

## What counts

Anything that breaks one of these promises:

- **Away runs stay in the box.** No writes outside the card's folder and Chompyy's cache, no network from the shell, no web tools unless you turn on `awayWeb`, no reading files outside the card's folder.
- **Nothing reaches your branch, or your repo's `.git`, until you press Keep.**
- **Your Claude login is only used to read your quota**, and only after you allow it.
- **The Mac app `chompyy app` installs is the one that was released**, checked before it opens.
- **Nothing leaves your Mac** except Claude Code's own traffic and the quota check to Anthropic.

## Supported versions

Only the latest release gets fixes. Update with `npm install -g chompyy@latest && chompyy app`.
