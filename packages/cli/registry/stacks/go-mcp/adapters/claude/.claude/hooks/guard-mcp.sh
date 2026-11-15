#!/usr/bin/env bash
# PreToolUse (Bash): prevent commands that would hold the session open.
set -euo pipefail
command -v jq >/dev/null 2>&1 || { /bin/cat >/dev/null; echo "guard-mcp.sh: jq is missing; allowing this call." >&2; exit 0; }
lib="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/.claude/hooks/_lib.sh"
{ [ -r "$lib" ] && source "$lib"; } 2>/dev/null || { /bin/cat >/dev/null; echo "guard-mcp.sh: shared helper unavailable; allowing this call." >&2; exit 0; }
input=$(cat) || { echo "guard-mcp.sh: cannot read payload; allowing this call." >&2; exit 0; }
command -v awk >/dev/null 2>&1 && command -v grep >/dev/null 2>&1 || { echo "guard-mcp.sh: required tools are missing; allowing this call." >&2; exit 0; }
lines=$(hook_foreground_commands "$input" 2>/dev/null) || { echo "guard-mcp.sh: unreadable payload or command; allowing this call." >&2; exit 0; }
while IFS= read -r line; do
  [ -n "$line" ] || continue
  if printf '%s\n' "$line" | grep -Eq '(^|[[:space:]])(--help|--version|-h)([[:space:]]|$)'; then continue; fi
  if printf '%s\n' "$line" | grep -Eq '^([^[:space:]]*/)?(npx|bunx|pnpx|npm[[:space:]]+exec|pnpm[[:space:]]+dlx|bun[[:space:]]+x)[[:space:]]+(-[^[:space:]]+[[:space:]]+)*@modelcontextprotocol/inspector(@[^[:space:]]+)?([[:space:]]|$)' &&
    ! printf '%s\n' "$line" | grep -Eq '(^|[[:space:]])--cli([[:space:]]|$)'; then
    hook_deny "The MCP Inspector web UI holds this shell open. Use make call or the Inspector --cli mode."; exit 0
  fi
done <<<"$lines"
exit 0
