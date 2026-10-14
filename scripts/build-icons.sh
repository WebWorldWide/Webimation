#!/usr/bin/env bash
# Regenerates every app icon from assets/logo/build.py.
#   • Windows / Linux / fallback PNG + ICO + ICNS from assets/logo/app-icon.svg (tauri icon)
#   • macOS 26+ Liquid Glass icon: compiles assets/logo/Webimation.icon (Icon Composer) with actool
#     into src-tauri/icons/Assets.car; Info.plist points CFBundleIconName at it.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -I assets/logo/build.py
npx tauri icon assets/logo/app-icon.svg >/dev/null
rm -rf src-tauri/icons/android src-tauri/icons/ios
cp assets/logo/app-icon.svg public/favicon.svg
if command -v xcrun >/dev/null && xcrun --find actool >/dev/null 2>&1; then
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  cp -R assets/logo/Webimation.icon "$tmp/AppIcon.icon"
  xcrun actool "$tmp/AppIcon.icon" --compile "$tmp" --platform macosx --minimum-deployment-target 11.0 \
    --app-icon AppIcon --output-partial-info-plist "$tmp/partial.plist" >/dev/null
  cp "$tmp/Assets.car" src-tauri/icons/Assets.car
  cp "$tmp/AppIcon.icns" src-tauri/icons/icon.icns
  echo "Compiled Liquid Glass icon → src-tauri/icons/Assets.car"
else
  echo "actool not found (needs Xcode 26+ on macOS); kept the existing Assets.car"
fi
