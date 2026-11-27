#!/usr/bin/env bash
# Fails when a target's line coverage in an xcresult bundle is below a floor. `make coverage`
# calls it after the unit tests:
#
#   coverage-check.sh <xcresult> <target, e.g. App.app> <minimum percent> "<excluded file globs>"
#
# Excluded globs match file names (`*View.swift`); those files count toward neither side.
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "usage: coverage-check.sh <xcresult> <target> <minimum percent> \"<excluded globs>\"" >&2
  exit 2
fi

xcrun xccov view --report --json "$1" | /usr/bin/python3 -I -c '
import fnmatch, json, sys

target_name, minimum, excluded = sys.argv[1], float(sys.argv[2]), sys.argv[3].split()
report = json.load(sys.stdin)
target = next((t for t in report.get("targets", []) if t.get("name") == target_name), None)
if target is None:
    sys.exit(f"coverage: no target named {target_name} in the result bundle")

covered = executable = 0
for file in target.get("files", []):
    if any(fnmatch.fnmatch(file["name"], pattern) for pattern in excluded):
        continue
    covered += file["coveredLines"]
    executable += file["executableLines"]
if executable == 0:
    sys.exit(f"coverage: {target_name} has no executable lines outside the exclusions")

percent = 100 * covered / executable
print(f"coverage: {target_name} {percent:.1f}% of {executable} lines (minimum {minimum:g}%)", flush=True)
if percent < minimum:
    sys.exit(f"coverage: below the {minimum:g}% floor; add unit tests or lower COVERAGE_MIN in the Makefile")
' "$2" "$3" "$4"
