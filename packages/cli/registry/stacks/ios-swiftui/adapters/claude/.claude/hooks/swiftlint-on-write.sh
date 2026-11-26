#!/usr/bin/env bash
# PostToolUse (Edit|Write): run SwiftLint on the Swift file just written and hand any findings
# back to the agent as context, so it fixes them now instead of at `make lint`. Advisory: never
# blocks and never rewrites the file. Layout is swift-format's job (`make fmt`), so this reports
# only SwiftLint rules. No SwiftLint, no .swiftlint.yml, a file outside the project, a crash or a
# timeout: exit 0 with no output.
set -euo pipefail
lib="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/.claude/hooks/_lib.sh"
# shellcheck source=/dev/null
{ [ -r "$lib" ] && source "$lib"; } 2>/dev/null || { cat >/dev/null 2>&1 || while IFS= read -r _; do :; done; echo "swiftlint-on-write.sh: shared helper unavailable; allowing this call." >&2; exit 0; }
input=$(cat 2>/dev/null) || exit 0
file_path=$(hook_get "$input" tool_input.file_path 2>/dev/null | head -n 1) || exit 0

case "$file_path" in
*.swift) ;;
*) exit 0 ;;
esac
[ -f "$file_path" ] || exit 0
command -v swiftlint >/dev/null 2>&1 || exit 0

file_dir=$(cd "$(dirname "$file_path")" && pwd -P) || exit 0
file_path="$file_dir/$(basename "$file_path")"
root=$(cd "$(project_root)" && pwd -P) || exit 0
case "$file_path" in
"$root"/build/* | "$root"/*.xcodeproj/*) exit 0 ;;
"$root"/*) ;;
*) exit 0 ;;
esac
cfg=$(find_up "$file_dir" .swiftlint.yml) || exit 0

rc=0
# --force-exclude keeps the config's `excluded` paths quiet even when named directly.
out=$(cd "$cfg" && with_timeout 30 swiftlint lint --quiet --strict --force-exclude --reporter xcode "$file_path") || rc=$?
# 0 is clean; 124 and above is a timeout or a signal. Anything else with output is a finding.
if [ "$rc" -eq 0 ] || [ "$rc" -ge 124 ]; then exit 0; fi
out=$(printf '%s' "$out" | grep -E ':[0-9]+:[0-9]+: ' | strip_control || true)
[ -n "$out" ] || exit 0
prefix="$root/"
out=${out//"$prefix"/}
out=$(printf '%s\n' "$out" | head -n 40)
hook_context PostToolUse "SwiftLint found issues in ${file_path#"$root"/}. Fix them before moving on:"$'\n'"$out"
exit 0
