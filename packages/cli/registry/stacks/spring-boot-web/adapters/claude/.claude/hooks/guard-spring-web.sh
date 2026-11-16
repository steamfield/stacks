#!/usr/bin/env bash
# PreToolUse (Bash): prevent commands that would hold the session open.
set -euo pipefail
command -v jq >/dev/null 2>&1 || { cat >/dev/null 2>&1 || while IFS= read -r _; do :; done; echo "guard-spring-web.sh: jq is missing; allowing this call." >&2; exit 0; }
lib="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/.claude/hooks/_lib.sh"
{ [ -r "$lib" ] && source "$lib"; } 2>/dev/null || { cat >/dev/null 2>&1 || while IFS= read -r _; do :; done; echo "guard-spring-web.sh: shared helper unavailable; allowing this call." >&2; exit 0; }
input=$(cat 2>/dev/null) || { cat >/dev/null 2>&1 || while IFS= read -r _; do :; done; echo "guard-spring-web.sh: cannot read payload; allowing this call." >&2; exit 0; }
command -v awk >/dev/null 2>&1 && command -v grep >/dev/null 2>&1 || { echo "guard-spring-web.sh: required tools are missing; allowing this call." >&2; exit 0; }
lines=$(hook_foreground_commands "$input" 2>/dev/null) || { echo "guard-spring-web.sh: unreadable payload or command; allowing this call." >&2; exit 0; }
while IFS= read -r line; do
  [ -n "$line" ] || continue
  if printf '%s\n' "$line" | grep -Eq '(^|[[:space:]])(--help|--version|-h)([[:space:]]|$)'; then continue; fi
  if printf '%s\n' "$line" | grep -Eq '^([^[:space:]]*/)?mvnw?([[:space:]]|$)' &&
    printf '%s\n' "$line" | grep -Eq '[[:space:]]spring-boot:run([[:space:]]|$)'; then
    hook_deny "spring-boot:run holds a JVM open. Run make serve in the background and stop the pid you started."; exit 0
  fi
done <<<"$lines"
exit 0
