# Card #22: one eye tempo at every quota level

The blueprint expected `mac/Sources/Chompyy/Mascot.swift` to be missing from this worktree. It is here, so
the change has been **made on this branch already**. These steps say what changed and how to check it.

## What changed

File: `mac/Sources/Chompyy/Mascot.swift`, class `MascotDirector`.

- `plan()` (the tempo function, it picks the next expression and how long to hold it) used to read
  `energy` (the share of the 5-hour window left). Near the limit it held each expression up to ~10 s and
  used gentle moves. Now it always uses the fresh-window values: hold about 0.7 s (randomly 0.5-0.9 s),
  move in 0.32 s, springy curve.
- `step(_:reducedMotion:)` no longer takes `energy:`. The two callers in `Cookie.swift` (the live cookie
  and the `CHOMPYY_RENDER_FRAMES` video renderer) were updated.
- Two other quieter-near-the-limit parts were tied to the same input and are gone too, so the vibe is the
  same everywhere: the breathing/sway amount is fixed at the fresh level (0.75), and blinks are always every
  4-7 s with an occasional double blink.
- Comments in `Mascot.swift`, `Cookie.swift` and the Chompyy's eyes row in `FEATURES.md` now say one tempo.

What still changes with quota: how much of the cookie is eaten and where the face sits. Only the motion
was made constant.

## How to check

1. No quota input to the tempo:

   ```sh
   grep -nE "energy|calm|springy" mac/Sources/Chompyy/Mascot.swift   # expect no code hits
   grep -n "energy:" mac/Sources/Chompyy/*.swift                     # expect nothing
   ```

2. It compiles (run from `mac/`):

   ```sh
   swift build
   ```

   Unattended, `swift build` couldn't run inside the sandbox (SwiftPM's own sandbox isn't allowed there), so
   the check run was `swiftc -typecheck -target arm64-apple-macosx14.0 -swift-version 6 Sources/Chompyy/*.swift`:
   0 errors.

3. Look at it:

   ```sh
   CHOMPYY_RENDER_COOKIES=/tmp/sheet.png .build/debug/Chompyy     # still poses, checks nothing broke in the look
   CHOMPYY_RENDER_FRAMES=/tmp/frames .build/debug/Chompyy         # scene 2 drains 100% -> 12%
   ```

   In the frames, scene 2 (the last 9 s) should swap expressions about as often as scene 1, instead of
   slowing to one every few seconds.

## Not done

- `docs/assets/chompyy.js` (the website's cookie) has its own copy of the old energy-based tempo. Left as is,
  since the card is about the app. Same three-line change applies there if you want the site to match.
- The app wasn't launched and no frames were rendered (no GUI in the unattended run).
