#!/usr/bin/env bash
# iOS tasks for verify and CI on macOS. `pods` installs CocoaPods through Bundler and runs
# pod install. `build` compiles a Release build of the app, its pods and the AppInfo module for
# the simulator without signing, with the JavaScript bundled in. `test` runs the AppInfo pod's
# Swift tests. `e2e` installs the `build` product and runs the Maestro flows in .maestro/ at the
# default text size, then at an accessibility text size. The last three use the iPhone simulator
# scripts/sim-destination.sh picks, need `pods` first, and pipe xcodebuild through xcbeautify
# when it is installed.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ "${1:-}" = pods ]; then
  # macOS's own Ruby carries a Bundler too old for current Rubies; a Gemfile.lock it writes
  # stamps that Bundler, and every other Ruby then fails to load it.
  if [ "$(command -v ruby)" = /usr/bin/ruby ]; then
    echo "ios.sh: ruby is macOS's system Ruby (/usr/bin/ruby). Put a Homebrew or version-manager Ruby first on PATH, then run bun run pods again." >&2
    exit 1
  fi
  # CocoaPods crashes on an encoding error without a UTF-8 locale, which CI and agent shells
  # often lack.
  case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
  *UTF-8* | *utf8* | *UTF8* | *utf-8*) ;;
  *) export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 ;;
  esac
  bundle install
  cd ios && exec bundle exec pod install
fi

workspace=$(find ios -maxdepth 1 -name '*.xcworkspace' -print -quit 2>/dev/null || true)
if [ -z "$workspace" ]; then
  echo "ios.sh: no ios/*.xcworkspace yet; run bun run pods first." >&2
  exit 1
fi
app=$(basename "$workspace" .xcworkspace)

# The native side starts the component registered under app.json's name; a mismatch builds
# fine and shows a blank red screen at launch.
registered=$(node -p 'require("./app.json").name')
if [ "$registered" != "$app" ]; then
  echo "ios.sh: app.json name is \"$registered\" but the Xcode workspace is $app; set app.json's name to $app." >&2
  exit 1
fi

# Not ios/build: pod install writes codegen output there, and a clean must not delete it.
derived=build/ios
product="$derived/Build/Products/Release-iphonesimulator/$app.app"

run() {
  if command -v xcbeautify >/dev/null 2>&1; then
    "$@" 2>&1 | xcbeautify --quiet
  else
    "$@"
  fi
}

# Maestro runs on a JDK. macOS ships a /usr/bin/java stub even without one, so ask java_home.
require_e2e_tools() {
  local missing=()
  /usr/libexec/java_home >/dev/null 2>&1 || missing+=("a JDK (/usr/libexec/java_home finds none; /usr/bin/java alone is a stub)")
  command -v maestro >/dev/null 2>&1 || missing+=("the maestro CLI (not on PATH)")
  if [ "${#missing[@]}" -gt 0 ]; then
    printf 'ios.sh: e2e needs %s.\n' "${missing[@]}" >&2
    echo "ios.sh: install them as the README's Getting started section says, then run bun run ios:e2e again." >&2
    exit 1
  fi
}

e2e() {
  require_e2e_tools
  if [ ! -d "$product" ]; then
    echo "ios.sh: no $product yet; run bun run ios:build first." >&2
    exit 1
  fi
  local destination udid bundle_id
  destination=$(bash scripts/sim-destination.sh)
  udid=${destination##*id=}
  bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$product/Info.plist")

  xcrun simctl boot "$udid" 2>/dev/null || true
  xcrun simctl bootstatus "$udid" -b >/dev/null
  xcrun simctl install "$udid" "$product"

  # Put the text size back even when a flow fails, so the simulator isn't left at a large size.
  trap 'xcrun simctl ui "$udid" content_size large >/dev/null 2>&1 || true' EXIT
  xcrun simctl ui "$udid" content_size large
  maestro --device "$udid" test -e APP_ID="$bundle_id" .maestro
  xcrun simctl ui "$udid" content_size accessibility-extra-large
  maestro --device "$udid" test -e APP_ID="$bundle_id" .maestro
}

case "${1:-}" in
build)
  destination=$(bash scripts/sim-destination.sh)
  run xcodebuild -workspace "$workspace" -scheme "$app" -configuration Release \
    -destination "$destination" -derivedDataPath "$derived" \
    ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO build
  ;;
test)
  destination=$(bash scripts/sim-destination.sh)
  run xcodebuild -workspace "$workspace" -scheme AppInfo-Unit-Tests \
    -destination "$destination" -derivedDataPath "$derived" \
    CODE_SIGNING_ALLOWED=NO test
  ;;
e2e)
  e2e
  ;;
*)
  echo "usage: scripts/ios.sh pods|build|test|e2e" >&2
  exit 2
  ;;
esac
