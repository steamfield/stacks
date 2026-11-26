#!/usr/bin/env bash
# PreToolUse (Bash): keep Metro and Jest's watch mode from hanging the session.
set -euo pipefail
command -v jq >/dev/null 2>&1 || { cat >/dev/null 2>&1 || while IFS= read -r _; do :; done; echo "guard-react-native.sh: jq is missing; allowing this call." >&2; exit 0; }
lib="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/.claude/hooks/_lib.sh"
# shellcheck source=/dev/null # agent-ops ships _lib.sh beside this hook
{ [ -r "$lib" ] && source "$lib"; } 2>/dev/null || { cat >/dev/null 2>&1 || while IFS= read -r _; do :; done; echo "guard-react-native.sh: shared helper unavailable; allowing this call." >&2; exit 0; }
input=$(cat 2>/dev/null) && [ -n "$input" ] || { cat >/dev/null 2>&1 || while IFS= read -r _; do :; done; echo "guard-react-native.sh: cannot read payload; allowing this call." >&2; exit 0; }
command -v awk >/dev/null 2>&1 || { echo "guard-react-native.sh: awk is missing; allowing this call." >&2; exit 0; }
lines=$(hook_foreground_argv "$input" 2>/dev/null) || { echo "guard-react-native.sh: unreadable payload or command; allowing this call." >&2; exit 0; }
match=$(printf '%s\n' "$lines" | awk -F '\t' '
    function words( i) {
      n = 0
      for (i = 2; i <= NF; i++) if ($i !~ /^-/ && $(i-1) !~ /^(--cwd|--filter|-F|--prefix)$/) w[++n] = $i
    }
    function watching( i) {
      for (i = 2; i <= NF; i++) if ($i ~ /^--watch(All)?(=true)?$/) return 1
      return 0
    }
    { delete w; words(); name = $1; sub(/.*\//, "", name)
      if (name ~ /^(bun|npm|pnpm|yarn)$/) {
        script = w[1] == "run" ? w[2] : w[1]
        if (script == "start" || script == "test:watch" || (script == "test" && watching())) { denied = 1; next }
      }
      if (name == "react-native" && w[1] == "start") { denied = 1; next }
      if (name ~ /^(npx|bunx)$/ && w[1] ~ /^(react-native|@react-native-community\/cli)(@.*)?$/ && w[2] == "start") { denied = 1; next }
      if ((name == "jest" || (name ~ /^(npx|bunx)$/ && w[1] ~ /^jest(@.*)?$/)) && watching()) { denied = 1; next }
    }
    END { if (denied) print "deny" }
  ' 2>/dev/null) || { echo "guard-react-native.sh: matcher unavailable; allowing this call." >&2; exit 0; }
if [ "$match" = deny ]; then
  hook_deny "Metro and Jest's watch mode never exit and would block this call. Run bun run test or bun run ios:test, or start Metro with run_in_background."; exit 0
fi
exit 0
