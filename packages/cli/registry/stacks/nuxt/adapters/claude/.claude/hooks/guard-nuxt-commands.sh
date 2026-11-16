#!/usr/bin/env bash
# PreToolUse (Bash): keep foreground servers from hanging the session.
set -euo pipefail
command -v jq >/dev/null 2>&1 || { cat >/dev/null 2>&1 || while IFS= read -r _; do :; done; echo "guard-nuxt-commands.sh: jq is missing; allowing this call." >&2; exit 0; }
lib="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/.claude/hooks/_lib.sh"
{ [ -r "$lib" ] && source "$lib"; } 2>/dev/null || { cat >/dev/null 2>&1 || while IFS= read -r _; do :; done; echo "guard-nuxt-commands.sh: shared helper unavailable; allowing this call." >&2; exit 0; }
input=$(cat 2>/dev/null) && [ -n "$input" ] || { cat >/dev/null 2>&1 || while IFS= read -r _; do :; done; echo "guard-nuxt-commands.sh: cannot read payload; allowing this call." >&2; exit 0; }
command -v awk >/dev/null 2>&1 || { echo "guard-nuxt-commands.sh: awk is missing; allowing this call." >&2; exit 0; }
lines=$(hook_foreground_argv "$input" 2>/dev/null) || { echo "guard-nuxt-commands.sh: unreadable payload or command; allowing this call." >&2; exit 0; }
match=$(printf '%s\n' "$lines" | awk -F '\t' '
    function target( i, n, w) {
      for (i = 2; i <= NF; i++) if ($i !~ /^-/ && $(i-1) !~ /^(--cwd|--filter|-F|--workspace|-w|--env-file)$/) w[++n] = $i
      return w[1] == "run" ? w[2] : ""
    }
    { name = $1; sub(/.*\//, "", name)
      if (name == "node") for (i = 2; i <= NF; i++) if ($i ~ /\.output\/server\/index\.mjs$/) { denied = 1; next }
      if (name ~ /^(nuxt|nuxi)$/ && $2 ~ /^(dev|preview)$/) { denied = 1; next }
      if (name !~ /^(bun|bunx|npx|npm|pnpm|yarn)$/) next
      if (target() ~ /^(dev|start)$/) { denied = 1; next }
      for (i = 2; i < NF; i++) if ($i ~ /(^|\/)(nuxt|nuxi)(@[^\/]*)?$/ && $(i+1) ~ /^(dev|preview)$/) { denied = 1; next }
    }
    END { if (denied) print "deny" }
  ' 2>/dev/null) || { echo "guard-nuxt-commands.sh: matcher unavailable; allowing this call." >&2; exit 0; }
if [ "$match" = deny ]; then
  hook_deny "A server never exits, so running it in the foreground hangs this session. Run it with run_in_background, or check the build with bun run e2e."; exit 0
fi
exit 0
