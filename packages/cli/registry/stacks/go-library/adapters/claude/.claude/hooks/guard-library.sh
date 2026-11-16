#!/usr/bin/env bash
# PreToolUse (Bash): prevent commands that would hold the session open.
set -euo pipefail
command -v jq >/dev/null 2>&1 || { cat >/dev/null 2>&1 || while IFS= read -r _; do :; done; echo "guard-library.sh: jq is missing; allowing this call." >&2; exit 0; }
lib="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/.claude/hooks/_lib.sh"
{ [ -r "$lib" ] && source "$lib"; } 2>/dev/null || { cat >/dev/null 2>&1 || while IFS= read -r _; do :; done; echo "guard-library.sh: shared helper unavailable; allowing this call." >&2; exit 0; }
input=$(cat 2>/dev/null) || { cat >/dev/null 2>&1 || while IFS= read -r _; do :; done; echo "guard-library.sh: cannot read payload; allowing this call." >&2; exit 0; }
command -v awk >/dev/null 2>&1 && command -v grep >/dev/null 2>&1 || { echo "guard-library.sh: required tools are missing; allowing this call." >&2; exit 0; }
lines=$(hook_foreground_commands "$input" 2>/dev/null) || { echo "guard-library.sh: unreadable payload or command; allowing this call." >&2; exit 0; }
while IFS= read -r line; do
  [ -n "$line" ] || continue
  if printf '%s\n' "$line" | grep -Eq '(^|[[:space:]])(--help|--version|-h)([[:space:]]|$)'; then continue; fi
  fuzztime='[[:space:]]--?(test\.)?fuzztime([=[:space:]]|$)'
  zero_fuzztime='[[:space:]]--?(test\.)?fuzztime[=[:space:]]+0+(\.0*)?(ns|us|ms|s|m|h|x)?([[:space:]]|$)'
  if printf '%s\n' "$line" | grep -Eq '^([^[:space:]]*/)?go[[:space:]]+test([[:space:]]|$)' &&
    printf '%s\n' "$line" | grep -Eq '[[:space:]]--?(test\.)?fuzz([=[:space:]]|$)' &&
    { ! printf '%s\n' "$line" | grep -Eq "$fuzztime" || printf '%s\n' "$line" | grep -Eq "$zero_fuzztime"; }; then
    hook_deny "Unbounded fuzzing can run forever. Run make fuzz, or add -fuzztime 30s."; exit 0
  fi
done <<<"$lines"
exit 0
