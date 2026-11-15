#!/usr/bin/env bash
# PreToolUse (Bash): keep foreground servers from hanging the session.
set -euo pipefail
command -v jq >/dev/null 2>&1 || { echo "guard-typescript-mcp-commands.sh: jq is missing; allowing this call." >&2; exit 0; }
lib="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/.claude/hooks/_lib.sh"
{ [ -r "$lib" ] && source "$lib"; } 2>/dev/null || { echo "guard-typescript-mcp-commands.sh: shared helper unavailable; allowing this call." >&2; exit 0; }
input=$(cat 2>/dev/null) && [ -n "$input" ] || { echo "guard-typescript-mcp-commands.sh: cannot read payload; allowing this call." >&2; exit 0; }
command -v awk >/dev/null 2>&1 || { echo "guard-typescript-mcp-commands.sh: awk is missing; allowing this call." >&2; exit 0; }
lines=$(hook_foreground_argv "$input" 2>/dev/null) || { echo "guard-typescript-mcp-commands.sh: unreadable payload or command; allowing this call." >&2; exit 0; }
match=$(printf '%s\n' "$lines" | awk -F '\t' '
    function target( i, n, w) {
      for (i = 2; i <= NF; i++) if ($i !~ /^-/ && $(i-1) !~ /^(--cwd|--filter|-F|--env-file)$/) w[++n] = $i
      verb = w[1]; return verb == "run" ? w[2] : verb
    }
    { name = $1; sub(/.*\//, "", name)
      if (name !~ /^(bun|bunx|npm|npx|pnpm|yarn|mcp-inspector|inspector)$/) next
      script = target()
      if (name ~ /^(mcp-inspector|inspector)$/) verb = name
      if (name !~ /^(bunx|npx|mcp-inspector|inspector)$/ && script == "inspect") { denied = 1; next }
      cli = 0; inspector = name ~ /^(mcp-inspector|inspector)$/
      for (i = 2; i <= NF; i++) { if ($i == "--cli") cli = 1; if ($i ~ /(^|\/|@modelcontextprotocol\/)(mcp-)?inspector(@.*)?$/) inspector = 1 }
      if (inspector && !cli && verb !~ /^(add|install|i)$/) { denied = 1; next }
    }
    END { if (denied) print "deny" }
  ' 2>/dev/null) || { echo "guard-typescript-mcp-commands.sh: matcher unavailable; allowing this call." >&2; exit 0; }
if [ "$match" = deny ]; then
  hook_deny "MCP Inspector's web UI never exits and would block this call. Use bun run smoke, or mcp-inspector --cli node dist/index.js --method tools/list (add -e MCP_ROOT=<dir>); run bun run inspect with run_in_background only for a person to open."; exit 0
fi
exit 0
