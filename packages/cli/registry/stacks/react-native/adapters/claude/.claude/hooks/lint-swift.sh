#!/usr/bin/env bash
# PostToolUse (Edit|Write): run `xcrun swift-format lint --strict` on a Swift file that was just
# written and hand its findings back as context. agent-ops' lint-on-write covers TypeScript with
# Biome; this covers the native modules. Only files under modules/ are linted, matching
# lint:native: the generated app sources in ios/ keep the generator's formatting. Advisory: never
# blocks, and stays silent when the file isn't Swift, xcrun is missing (Linux) or swift-format
# fails to run.
set -euo pipefail
lib="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/.claude/hooks/_lib.sh"
# shellcheck source=/dev/null # agent-ops ships _lib.sh beside this hook
{ [ -r "$lib" ] && source "$lib"; } 2>/dev/null || { cat >/dev/null 2>&1 || while IFS= read -r _; do :; done; echo "lint-swift.sh: shared helper unavailable; allowing this call." >&2; exit 0; }
input=$(cat 2>/dev/null) || exit 0

file_path=$(hook_get "$input" tool_input.file_path | head -n 1) || exit 0
case "$file_path" in modules/*.swift | */modules/*.swift) ;; *) exit 0 ;; esac
[ -f "$file_path" ] || exit 0
case "$file_path" in */Pods/* | */node_modules/* | */build/*) exit 0 ;; esac
command -v xcrun >/dev/null 2>&1 || exit 0

rc=0
out=$(with_timeout 20 xcrun swift-format lint --strict "$file_path" 2>&1) || rc=$?
# 1 means findings; anything else (a crash, a timeout, no swift-format) is not the file's fault.
[ "$rc" -eq 1 ] || exit 0
out=$(printf '%s' "$out" | strip_control | head -n 40)
[ -n "${out//[[:space:]]/}" ] || exit 0
hook_context PostToolUse "swift-format found issues in $(basename "$file_path"). Fix them before moving on:"$'\n'"$out"
exit 0
