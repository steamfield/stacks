#!/usr/bin/env bash
# PostToolUse (Edit|Write|MultiEdit): run `dart analyze` on the .dart file just
# written and hand its findings back as context, so the agent fixes them now
# rather than at `make analyze`. agent-ops' lint-on-write.sh has no Dart linter;
# this fills that gap with the same rules (analysis_options.yaml).
#
# Advisory and read-only: never blocks, never rewrites. No dart on PATH, no
# pubspec.yaml above the file, a file outside the project, a crash or a timeout:
# exit 0 with no output.
set -euo pipefail
input=$(cat 2>/dev/null) || { while IFS= read -r _; do :; done; echo "lint-dart.sh: cannot read payload; allowing this call." >&2; exit 0; }
hook_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# agent-ops ships _lib.sh beside this hook.
# shellcheck source=/dev/null
{ [ -r "$hook_dir/_lib.sh" ] && source "$hook_dir/_lib.sh"; } 2>/dev/null || { echo "lint-dart.sh: shared helper unavailable; allowing this call." >&2; exit 0; }

file_path=$(hook_get "$input" tool_input.file_path | head -n 1) || exit 0
case "$file_path" in *.dart) ;; *) exit 0 ;; esac
[ -f "$file_path" ] || exit 0
command -v dart >/dev/null 2>&1 || exit 0

file_dir=$(cd "$(dirname "$file_path")" && pwd -P) || exit 0
file_path="$file_dir/$(basename "$file_path")"
root=$(project_root)
root=$(cd "$root" && pwd -P) || exit 0
case "$file_path" in "$root"/*) ;; *) exit 0 ;; esac
case "$file_path" in */.dart_tool/* | */build/* | */.flutter-create/*) exit 0 ;; esac
package=$(find_up "$file_dir" pubspec.yaml) || exit 0

# --format=machine: SEVERITY|TYPE|CODE|FILE|LINE|COLUMN|LENGTH|MESSAGE.
# dart analyze exits non-zero when it finds anything, so read the output.
rc=0
out=$(cd "$package" && with_timeout 40 dart analyze --format=machine "$file_path") || rc=$?
[ "$rc" -lt 124 ] || exit 0
out=$(printf '%s\n' "$out" | strip_control | awk -F'|' 'NF >= 8 {
  msg = $8; for (i = 9; i <= NF; i++) msg = msg "|" $i
  printf "%s:%s:%s: %s %s: %s\n", $4, $5, $6, tolower($1), tolower($3), msg
}')
prefix="$root/"
out=${out//"$prefix"/}
[ -n "${out//[[:space:]]/}" ] || exit 0

max_lines=40
if [ "$(wc -l <<<"$out" | tr -d ' ')" -gt "$max_lines" ]; then
  out="$(head -n "$max_lines" <<<"$out")"$'\n'"... (truncated; run dart analyze on this file for the rest)"
fi
hook_context PostToolUse "dart analyze found issues in ${file_path#"$root"/}. Fix them before moving on:"$'\n'"$out"
exit 0
