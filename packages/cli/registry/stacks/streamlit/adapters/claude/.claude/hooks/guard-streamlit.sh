#!/usr/bin/env bash
# PreToolUse (Bash): prevent commands that would hold the session open.
set -euo pipefail
command -v jq >/dev/null 2>&1 || { cat >/dev/null 2>&1 || while IFS= read -r _; do :; done; echo "guard-streamlit.sh: jq is missing; allowing this call." >&2; exit 0; }
lib="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/.claude/hooks/_lib.sh"
{ [ -r "$lib" ] && source "$lib"; } 2>/dev/null || { cat >/dev/null 2>&1 || while IFS= read -r _; do :; done; echo "guard-streamlit.sh: shared helper unavailable; allowing this call." >&2; exit 0; }
input=$(cat 2>/dev/null) || { cat >/dev/null 2>&1 || while IFS= read -r _; do :; done; echo "guard-streamlit.sh: cannot read payload; allowing this call." >&2; exit 0; }
command -v awk >/dev/null 2>&1 && command -v grep >/dev/null 2>&1 || { echo "guard-streamlit.sh: required tools are missing; allowing this call." >&2; exit 0; }
lines=$(hook_foreground_commands "$input" 2>/dev/null) || { echo "guard-streamlit.sh: unreadable payload or command; allowing this call." >&2; exit 0; }
while IFS= read -r line; do
  [ -n "$line" ] || continue
  if printf '%s\n' "$line" | grep -Eq '(^|[[:space:]])(--help|--version|-h)([[:space:]]|$)'; then continue; fi
  if printf '%s\n' "$line" | grep -Eq '^([^[:space:]]*/)?(python[0-9.]*[[:space:]]+-m[[:space:]]+)?streamlit([[:space:]]+-[^[:space:]]+)*[[:space:]]+(run|hello)([[:space:]]|$)|^([^[:space:]]*/)?make([[:space:]]+[^[:space:]]+)*[[:space:]]+(dev|start)([[:space:]]|$)'; then
    hook_deny "Streamlit keeps a server in the foreground. Run make test with AppTest, or let stacks verify serve and probe it."; exit 0
  fi
done <<<"$lines"
exit 0
