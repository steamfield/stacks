#!/usr/bin/env bash
# PreToolUse (Edit|Write|MultiEdit|Bash): deny hand edits inside the generated Xcode project.
# XcodeGen writes *.xcodeproj (and the workspace inside it) from project.yml on every
# `make project`, so an edit there is lost on the next run and hides the change from review.
# Reading the project is fine; only writes are denied. Fails open when a helper is missing.
set -euo pipefail
lib="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/.claude/hooks/_lib.sh"
# shellcheck source=/dev/null # agent-ops ships _lib.sh beside this hook
{ [ -r "$lib" ] && source "$lib"; } 2>/dev/null || { cat >/dev/null 2>&1 || while IFS= read -r _; do :; done; echo "protect-xcodeproj.sh: shared helper unavailable; allowing this call." >&2; exit 0; }
input=$(cat 2>/dev/null) || { echo "protect-xcodeproj.sh: cannot read payload; allowing this call." >&2; exit 0; }
command -v grep >/dev/null 2>&1 || { echo "protect-xcodeproj.sh: grep is missing; allowing this call." >&2; exit 0; }

reason="The Xcode project is generated from project.yml by XcodeGen. Change project.yml (targets, settings, schemes), then run make project."
generated='\.(xcodeproj|xcworkspace)(/|$)|\.pbxproj([^[:alnum:]]|$)'

# Edit, Write and MultiEdit carry the target in tool_input.file_path.
path=$(hook_get "$input" tool_input.file_path | head -n 1) || path=""
if [ -n "$path" ]; then
  if printf '%s\n' "$path" | grep -Eq "$generated"; then hook_deny "$reason"; fi
  exit 0
fi

# Bash: in-place editors, redirections, tee and plist writers aimed at the generated project.
command=$(hook_get "$input" tool_input.command) || command=""
[ -n "$command" ] || exit 0
printf '%s\n' "$command" | grep -Eq "$generated" || exit 0
writer='(^|[;&|[:space:]])(sed|perl)[[:space:]]+([^;&|]*[[:space:]])?-[[:alnum:]]*i|>>?[[:space:]]*[^[:space:]]*\.(xcodeproj|xcworkspace|pbxproj)|(^|[;&|[:space:]])tee[[:space:]]|PlistBuddy|plutil[[:space:]]+-(replace|insert|remove)'
if printf '%s\n' "$command" | grep -Eq "$writer"; then hook_deny "$reason"; fi
exit 0
