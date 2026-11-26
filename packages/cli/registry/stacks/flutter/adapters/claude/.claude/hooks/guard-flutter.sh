#!/usr/bin/env bash
# PreToolUse (Bash): keep flutter run, attach and logs from hanging the session.
set -euo pipefail
command -v jq >/dev/null 2>&1 || { cat >/dev/null 2>&1 || while IFS= read -r _; do :; done; echo "guard-flutter.sh: jq is missing; allowing this call." >&2; exit 0; }
lib="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/.claude/hooks/_lib.sh"
# shellcheck source=/dev/null # agent-ops ships _lib.sh beside this hook
{ [ -r "$lib" ] && source "$lib"; } 2>/dev/null || { cat >/dev/null 2>&1 || while IFS= read -r _; do :; done; echo "guard-flutter.sh: shared helper unavailable; allowing this call." >&2; exit 0; }
input=$(cat 2>/dev/null) && [ -n "$input" ] || { cat >/dev/null 2>&1 || while IFS= read -r _; do :; done; echo "guard-flutter.sh: cannot read payload; allowing this call." >&2; exit 0; }
command -v awk >/dev/null 2>&1 || { echo "guard-flutter.sh: awk is missing; allowing this call." >&2; exit 0; }
lines=$(hook_foreground_argv "$input" 2>/dev/null) || { echo "guard-flutter.sh: unreadable payload or command; allowing this call." >&2; exit 0; }
match=$(printf '%s\n' "$lines" | awk -F '\t' '
    { n = 0; delete w
      for (i = 1; i <= NF; i++) if ($i !~ /^-/) w[++n] = $i
      name = w[1]; sub(/.*\//, "", name); first = 2
      if (name == "fvm") { name = w[2]; sub(/.*\//, "", name); first = 3 }
      if (name == "flutter" && w[first] ~ /^(run|attach|logs)$/) { denied = 1; next }
    }
    END { if (denied) print "deny" }
  ' 2>/dev/null) || { echo "guard-flutter.sh: matcher unavailable; allowing this call." >&2; exit 0; }
if [ "$match" = deny ]; then
  hook_deny "flutter run, attach and logs stay attached to the app and would block this call. Run make test or make test-ios, or start the app with run_in_background."; exit 0
fi
exit 0
