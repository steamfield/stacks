#!/usr/bin/env bash
# Run the Clang static analyzer over the App scheme and fail on any finding.
#
# `xcodebuild analyze` reports "Analyze Succeeded" even when the analyzer finds
# bugs, and on a rerun it skips files that haven't changed, so their findings
# aren't printed again. Xcode keeps one result plist per analyzed file in
# DerivedData, though, so this reads every plist after the run: a finding stays
# a failure until the file is fixed.
set -euo pipefail

bash scripts/xcodebuild.sh analyze analyze

found=0
while IFS= read -r plist; do
  count=$(plutil -extract diagnostics raw -o - "$plist" 2>/dev/null || echo 0)
  [ "$count" -gt 0 ] || continue
  file=$(plutil -extract files.0 raw -o - "$plist" 2>/dev/null || echo "$plist")
  file=${file#"$(pwd -P)"/}
  i=0
  while [ "$i" -lt "$count" ]; do
    line=$(plutil -extract "diagnostics.$i.location.line" raw -o - "$plist")
    what=$(plutil -extract "diagnostics.$i.description" raw -o - "$plist")
    check=$(plutil -extract "diagnostics.$i.check_name" raw -o - "$plist")
    echo "${file#"$PWD"/}:$line: $what [$check]" >&2
    found=$((found + 1))
    i=$((i + 1))
  done
done < <(find build/DerivedData -path '*/StaticAnalyzer/*' -name '*.plist' 2>/dev/null)

if [ "$found" -gt 0 ]; then
  echo "analyze: $found static analyzer finding(s) above. Fix the code; never silence the checker." >&2
  exit 1
fi
echo "analyze: no findings"
