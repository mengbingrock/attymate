#!/usr/bin/env bash
# Build a native Apple Silicon (arm64) AttyMate.
#
# macOS requires arm64 apps to carry at least an AD-HOC code signature to launch
# (an unsigned arm64 app is killed as "damaged" — unlike x64, which Rosetta
# tolerates). electron-builder only skips signing when no Developer ID cert is
# present, so we ad-hoc sign the unpacked app ourselves (no hardened runtime, so
# V8 JIT keeps working) and repackage the .zip + .dmg from the signed app.
#
# Produces (unsigned-but-ad-hoc, not notarized → right-click → Open on first run):
#   dist/AttyMate-<ver>-arm64-mac.zip
#   dist/AttyMate-<ver>-arm64.dmg
set -euo pipefail
cd "$(dirname "$0")/.."

VER=$(node -p "require('./package.json').version")
APP="dist/mac-arm64/AttyMate.app"

pnpm build:main
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --arm64

echo "==> ad-hoc signing $APP"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

echo "==> repackaging zip"
rm -f "dist/AttyMate-${VER}-arm64-mac.zip"
ditto -c -k --sequesterRsrc --keepParent "$APP" "dist/AttyMate-${VER}-arm64-mac.zip"

echo "==> repackaging dmg"
STAGE=$(mktemp -d)
ditto "$APP" "$STAGE/AttyMate.app"
ln -s /Applications "$STAGE/Applications"
rm -f "dist/AttyMate-${VER}-arm64.dmg"
hdiutil create -volname "AttyMate" -srcfolder "$STAGE" -ov -format UDZO "dist/AttyMate-${VER}-arm64.dmg"
rm -rf "$STAGE"

echo "==> done:"
ls -lh "dist/AttyMate-${VER}-arm64.dmg" "dist/AttyMate-${VER}-arm64-mac.zip"
