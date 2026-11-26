#!/usr/bin/env bash
# PostToolUse (Edit|Write|MultiEdit): lint the Swift file just written with SwiftLint and
# swift-format, and hand any findings back to the agent as context so it fixes them now.
# agent-ops' lint-on-write.sh skips Swift, so this hook covers it. Advisory: never blocks,
# never rewrites the file (run make fmt for that). Silent when a tool is missing or times out.
set -euo pipefail
lib="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/.claude/hooks/_lib.sh"
# shellcheck source=/dev/null # agent-ops ships _lib.sh beside this hook
{ [ -r "$lib" ] && source "$lib"; } 2>/dev/null || { cat >/dev/null 2>&1 || while IFS= read -r _; do :; done; echo "lint-swift.sh: shared helper unavailable; allowing this call." >&2; exit 0; }
input=$(cat 2>/dev/null) || exit 0

file=$(hook_get "$input" tool_input.file_path | head -n 1) || exit 0
case "$file" in *.swift) ;; *) exit 0 ;; esac
[ -f "$file" ] || exit 0
case "$file" in */build/* | */DerivedData/* | */.build/*) exit 0 ;; esac

root=$(project_root)
root=$(cd "$root" && pwd -P) || exit 0
file="$(cd "$(dirname "$file")" && pwd -P)/$(basename "$file")"
case "$file" in "$root"/*) ;; *) exit 0 ;; esac
cd "$root"

out=""
if command -v swiftlint >/dev/null 2>&1 && [ -f .swiftlint.yml ]; then
  rc=0
  lint=$(with_timeout 30 swiftlint lint --strict --quiet "$file") || rc=$?
  # 2 means violations; anything else (crash, timeout, file excluded by config) says nothing.
  [ "$rc" -eq 2 ] && out="$lint"
fi
if xcrun --find swift-format >/dev/null 2>&1; then
  rc=0
  fmt=$(with_timeout 30 xcrun swift-format lint --strict "$file") || rc=$?
  [ "$rc" -eq 1 ] && out="${out:+$out$'\n'}$fmt"$'\n'"(layout findings: run make fmt)"
fi

out=$(printf '%s' "$out" | strip_control)
[ -n "${out//[[:space:]]/}" ] || exit 0
prefix="$root/"
out=${out//"$prefix"/}
max_lines=60
if [ "$(wc -l <<<"$out" | tr -d ' ')" -gt "$max_lines" ]; then
  out="$(head -n "$max_lines" <<<"$out")"$'\n'"... (truncated; run make lint fmt-check)"
fi
hook_context PostToolUse "Swift lint found issues in ${file#"$root"/}. Fix them before moving on:"$'\n'"$out"
exit 0
