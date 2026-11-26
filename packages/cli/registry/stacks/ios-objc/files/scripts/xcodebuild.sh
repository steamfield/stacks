#!/usr/bin/env bash
# Run xcodebuild for the App scheme on a simulator, with a full log kept in
# build/logs/<action>.log and readable output through xcbeautify when it's
# installed. Usage: bash scripts/xcodebuild.sh <log-name> <xcodebuild args...>
#
# Simulator builds don't sign (CODE_SIGNING_ALLOWED=NO), parallel testing is off
# so xcodebuild never clones simulators, and DerivedData stays in build/.
set -euo pipefail

name=$1
shift
project=$(find . -maxdepth 1 -name '*.xcodeproj' -print -quit)
if [ -z "$project" ]; then
  echo "xcodebuild.sh: no .xcodeproj; run make project" >&2
  exit 1
fi
destination=$(bash scripts/sim-destination.sh)
mkdir -p build/logs
log="build/logs/$name.log"

set +e
xcodebuild -project "$project" -scheme App -derivedDataPath build/DerivedData \
  -destination "$destination" -parallel-testing-enabled NO \
  CODE_SIGNING_ALLOWED=NO "$@" 2>&1 | tee "$log" | {
  if ! command -v xcbeautify >/dev/null 2>&1; then
    cat
  elif [ -t 1 ]; then
    xcbeautify --quiet
  else
    xcbeautify --quiet --disable-colored-output
  fi
}
status=${PIPESTATUS[0]}
set -e

if [ "$status" -ne 0 ]; then
  echo "xcodebuild failed (exit $status); full log in $log" >&2
fi
exit "$status"
