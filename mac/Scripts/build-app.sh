#!/usr/bin/env bash
# Build Chompyy.app from the Swift package: mac/build/Chompyy.app
# Usage: mac/Scripts/build-app.sh [--open]
set -euo pipefail
cd "$(dirname "$0")/.."

swift build -c release
BIN="$(swift build -c release --show-bin-path)/Chompyy"
APP="build/Chompyy.app"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/Chompyy"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Chompyy</string>
  <key>CFBundleDisplayName</key><string>Chompyy</string>
  <key>CFBundleIdentifier</key><string>com.branchwork.chompyy</string>
  <key>CFBundleExecutable</key><string>Chompyy</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <!-- Lives in the menu bar; the board opens as a normal window. -->
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# Ad-hoc signature so macOS runs it locally. A Developer ID signature comes with release packaging.
codesign --force --sign - "$APP" >/dev/null
echo "Built $(pwd)/$APP"

if [[ "${1:-}" == "--open" ]]; then
  pkill -x Chompyy 2>/dev/null || true
  open "$APP"
fi
