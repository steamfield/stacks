#!/usr/bin/env bash
# iOS tasks for verify and CI on macOS. `pods` installs CocoaPods through Bundler and runs
# pod install. `build` compiles the app, its pods and the AppInfo module for the simulator
# without signing. `test` runs the AppInfo pod's XCTest bundle on an available iPhone simulator
# (scripts/sim-destination.sh picks it). Both need `pods` first, and pipe through xcbeautify
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

run() {
  if command -v xcbeautify >/dev/null 2>&1; then
    "$@" 2>&1 | xcbeautify --quiet
  else
    "$@"
  fi
}

case "${1:-}" in
build)
  run xcodebuild -workspace "$workspace" -scheme "$app" -configuration Debug \
    -destination "generic/platform=iOS Simulator" -derivedDataPath "$derived" \
    CODE_SIGNING_ALLOWED=NO build
  ;;
test)
  destination=$(bash scripts/sim-destination.sh)
  run xcodebuild -workspace "$workspace" -scheme AppInfo-Unit-Tests \
    -destination "$destination" -derivedDataPath "$derived" \
    CODE_SIGNING_ALLOWED=NO test
  ;;
*)
  echo "usage: scripts/ios.sh pods|build|test" >&2
  exit 2
  ;;
esac
