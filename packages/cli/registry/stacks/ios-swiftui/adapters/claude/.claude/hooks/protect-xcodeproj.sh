#!/usr/bin/env bash
# PreToolUse (Edit|Write): deny writes inside *.xcodeproj and *.xcworkspace. XcodeGen generates
# the project from project.yml, so a hand edit is lost on the next `make project`, and a broken
# project.pbxproj stops every build. Missing helpers allow the call with a note.
set -euo pipefail
lib="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/.claude/hooks/_lib.sh"
# shellcheck source=/dev/null
{ [ -r "$lib" ] && source "$lib"; } 2>/dev/null || { cat >/dev/null 2>&1 || while IFS= read -r _; do :; done; echo "protect-xcodeproj.sh: shared helper unavailable; allowing this call." >&2; exit 0; }
input=$(cat 2>/dev/null) || { echo "protect-xcodeproj.sh: cannot read payload; allowing this call." >&2; exit 0; }
file_path=$(hook_get "$input" tool_input.file_path 2>/dev/null | head -n 1) || { echo "protect-xcodeproj.sh: unreadable payload; allowing this call." >&2; exit 0; }

case "$file_path" in
*.xcodeproj | *.xcodeproj/* | *.xcworkspace | *.xcworkspace/* | *.pbxproj)
  hook_deny "The Xcode project is generated from project.yml by XcodeGen, so edits here are lost on the next make project. Change project.yml (targets, settings, schemes) and run make project instead."
  ;;
esac
exit 0
