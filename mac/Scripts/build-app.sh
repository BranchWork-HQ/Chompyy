#!/usr/bin/env bash
# Build Chompyy.app from the Swift package: mac/build/Chompyy.app
# Usage: mac/Scripts/build-app.sh [--open] [--release]
#   --release  universal binary (Apple Silicon + Intel) with Node and the CLI bundled inside (works without
#              npm), plus build/Chompyy-<version>.zip (for `chompyy app`) and build/Chompyy.dmg (the website download)
set -euo pipefail
cd "$(dirname "$0")/.."

OPEN=0; RELEASE=0
for a in "$@"; do
  case "$a" in
    --open) OPEN=1 ;;
    --release) RELEASE=1 ;;
    *) echo "unknown option $a" >&2; exit 1 ;;
  esac
done

# One version for the CLI and the app: `chompyy app` downloads the zip matching the CLI's version.
VERSION="$(node -p "require('../cli/package.json').version")"

if [[ $RELEASE == 1 ]]; then
  ARCHS=(--arch arm64 --arch x86_64)
else
  ARCHS=()
fi
swift build -c release ${ARCHS[@]+"${ARCHS[@]}"}
BIN="$(swift build -c release ${ARCHS[@]+"${ARCHS[@]}"} --show-bin-path)/Chompyy"
APP="build/Chompyy.app"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/Chompyy"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Chompyy</string>
  <key>CFBundleDisplayName</key><string>Chompyy</string>
  <key>CFBundleIdentifier</key><string>com.branchwork.chompyy</string>
  <key>CFBundleExecutable</key><string>Chompyy</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <!-- Lives in the menu bar; the board opens as a normal window. -->
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# Release: bundle Node (universal) and the CLI, so the downloaded app needs nothing else but Claude Code.
NODE_VERSION="22.19.0"
if [[ $RELEASE == 1 ]]; then
  (cd ../cli && npm run build >/dev/null)
  CLI_DIR="$APP/Contents/Resources/cli"
  mkdir -p "$CLI_DIR"
  cp -R ../cli/dist ../cli/skills ../cli/vendor ../cli/package.json "$CLI_DIR/"
  cp ../LICENSE ../THIRD_PARTY_NOTICES.md "$CLI_DIR/" 2>/dev/null || true
  CACHE="build/node-cache/$NODE_VERSION"
  if [[ ! -x "$CACHE/node" ]]; then
    mkdir -p "$CACHE"
    for arch in arm64 x64; do
      curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-darwin-$arch.tar.gz" | tar -xz -C "$CACHE" "node-v$NODE_VERSION-darwin-$arch/bin/node" "node-v$NODE_VERSION-darwin-$arch/LICENSE"
    done
    lipo -create "$CACHE/node-v$NODE_VERSION-darwin-arm64/bin/node" "$CACHE/node-v$NODE_VERSION-darwin-x64/bin/node" -output "$CACHE/node"
    cp "$CACHE/node-v$NODE_VERSION-darwin-arm64/LICENSE" "$CACHE/NODE_LICENSE"
  fi
  cp "$CACHE/node" "$APP/Contents/Resources/node"
  cp "$CACHE/NODE_LICENSE" "$APP/Contents/Resources/NODE_LICENSE"
  codesign --force --sign - "$APP/Contents/Resources/node" >/dev/null
fi

# Ad-hoc signature so macOS runs it locally. A Developer ID signature comes with release packaging.
codesign --force --sign - "$APP" >/dev/null
echo "Built $(pwd)/$APP"

if [[ $RELEASE == 1 ]]; then
  ZIP="build/Chompyy-$VERSION.zip"
  rm -f "$ZIP"
  ditto -c -k --keepParent "$APP" "$ZIP"
  echo "Release zip: $(pwd)/$ZIP ($(lipo -archs "$APP/Contents/MacOS/Chompyy"))"
  # The website download: a disk image with the app and a link to Applications to drag it onto.
  DMG="build/Chompyy.dmg"
  STAGE="build/dmg-stage"
  rm -rf "$STAGE" "$DMG"
  mkdir -p "$STAGE"
  cp -R "$APP" "$STAGE/"
  ln -s /Applications "$STAGE/Applications"
  hdiutil create -volname "Chompyy" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
  rm -rf "$STAGE"
  echo "Disk image: $(pwd)/$DMG ($(du -h "$DMG" | cut -f1))"
fi

if [[ $OPEN == 1 ]]; then
  pkill -x Chompyy 2>/dev/null || true
  open "$APP"
fi
