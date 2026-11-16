#!/usr/bin/env bash
# PreToolUse (Bash): prevent commands that would hold the session open.
set -euo pipefail
command -v jq >/dev/null 2>&1 || { cat >/dev/null 2>&1 || while IFS= read -r _; do :; done; echo "guard-tui.sh: jq is missing; allowing this call." >&2; exit 0; }
lib="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/.claude/hooks/_lib.sh"
{ [ -r "$lib" ] && source "$lib"; } 2>/dev/null || { cat >/dev/null 2>&1 || while IFS= read -r _; do :; done; echo "guard-tui.sh: shared helper unavailable; allowing this call." >&2; exit 0; }
input=$(cat 2>/dev/null) || { cat >/dev/null 2>&1 || while IFS= read -r _; do :; done; echo "guard-tui.sh: cannot read payload; allowing this call." >&2; exit 0; }
command -v awk >/dev/null 2>&1 && command -v grep >/dev/null 2>&1 || { echo "guard-tui.sh: required tools are missing; allowing this call." >&2; exit 0; }
lines=$(hook_foreground_commands "$input" 2>/dev/null) || { echo "guard-tui.sh: unreadable payload or command; allowing this call." >&2; exit 0; }
while IFS= read -r line; do
  [ -n "$line" ] || continue
  if printf '%s\n' "$line" | grep -Eq '(^|[[:space:]])(--help|--version|-h)([[:space:]]|$)'; then continue; fi
  if ! printf '%s\n' "$line" | grep -Eq '(cargo([[:space:]]+\+[^[:space:]]+)?[[:space:]]+run|target/(debug|release)/)' ||
    printf '%s\n' "$line" | grep -Eq '(^|[[:space:]])--(no-tui|json)([[:space:]]|$)'; then
    continue
  fi
  if printf '%s\n' "$line" | grep -Eq '^([^[:space:]]*/)?(tmux|screen)[[:space:]]' &&
    printf '%s\n' "$line" | grep -Eq '[[:space:]]-(d|dm|dmS)([[:space:]]|$)'; then
    continue
  fi
  if printf '%s\n' "$line" | grep -Eq '^([^[:space:]]*/)?(script|unbuffer|tmux|screen)([[:space:]]|$)'; then
    hook_deny "The interactive UI waits for keys in a fake terminal. Run make test, or use --no-tui or --json."; exit 0
  fi
done <<<"$lines"
exit 0
