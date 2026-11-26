#!/usr/bin/env bash
# Check line coverage of the App target in a test result bundle against a floor.
# Usage: bash scripts/coverage.sh <result.xcresult> <minimum percent>
# The floor lives in the Makefile (COVERAGE_MIN); change it there, never here.
set -euo pipefail

bundle=$1
minimum=$2

report=$(xcrun xccov view --report --json "$bundle") || {
  echo "coverage: xccov couldn't read $bundle; did the tests run with coverage enabled?" >&2
  exit 1
}

# JavaScript for Automation ships with macOS, so parsing the JSON needs no extra tool.
# Prints "<covered> <executable> <percent>" for the app target, or nothing if it's missing.
summary=$(osascript -l JavaScript - "$report" <<'JS'
function run(argv) {
  const targets = JSON.parse(argv[0]).targets || [];
  const app = targets.find((t) => t.name === "App.app");
  if (!app) return "";
  const percent = app.executableLines ? (100 * app.coveredLines) / app.executableLines : 0;
  return `${app.coveredLines} ${app.executableLines} ${percent.toFixed(1)}`;
}
JS
)

if [ -z "$summary" ]; then
  echo "coverage: no App.app target in the report; check coverageTargets in project.yml" >&2
  exit 1
fi
read -r covered executable percent <<<"$summary"
echo "coverage: App line coverage $percent% ($covered of $executable lines), minimum $minimum%"
if ! awk -v p="$percent" -v m="$minimum" 'BEGIN { exit !(p + 0 >= m + 0) }'; then
  echo "coverage: below the $minimum% floor. Add tests for the uncovered code (xcrun xccov view --report $bundle lists each file)." >&2
  exit 1
fi
