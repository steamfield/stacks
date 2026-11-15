#!/usr/bin/env bash
# PreToolUse (Bash): keep foreground servers from hanging the session.
set -euo pipefail
command -v jq >/dev/null 2>&1 || { echo "guard-api-commands.sh: jq is missing; allowing this call." >&2; exit 0; }
lib="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/.claude/hooks/_lib.sh"
{ [ -r "$lib" ] && source "$lib"; } 2>/dev/null || { echo "guard-api-commands.sh: shared helper unavailable; allowing this call." >&2; exit 0; }
input=$(cat 2>/dev/null) && [ -n "$input" ] || { echo "guard-api-commands.sh: cannot read payload; allowing this call." >&2; exit 0; }
command -v awk >/dev/null 2>&1 || { echo "guard-api-commands.sh: awk is missing; allowing this call." >&2; exit 0; }
lines=$(hook_foreground_argv "$input" 2>/dev/null) || { echo "guard-api-commands.sh: unreadable payload or command; allowing this call." >&2; exit 0; }
match=$(printf '%s\n' "$lines" | awk -F '\t' '
    function target( i, n, w) {
      for (i = 2; i <= NF; i++) if ($i !~ /^-/ && $(i-1) !~ /^(--cwd|--filter|-F|--workspace|-w|--env-file)$/) w[++n] = $i
      return w[1] == "run" ? w[2] : w[1]
    }
    { name = $1; sub(/.*\//, "", name)
      if (name ~ /^(bun|npm|pnpm|yarn)$/ && target() == "dev") { denied = 1; next }
    }
    END { if (denied) print "deny" }
  ' 2>/dev/null) || { echo "guard-api-commands.sh: matcher unavailable; allowing this call." >&2; exit 0; }
if [ "$match" = deny ]; then
  hook_deny "bun run dev runs the dev servers in the foreground and blocks this shell. Use bun run dev:bg (stop them with bun run dev:stop)."; exit 0
fi
exit 0
