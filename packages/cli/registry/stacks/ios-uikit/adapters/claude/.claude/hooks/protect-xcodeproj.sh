#!/usr/bin/env bash
# PreToolUse (Edit|Write|MultiEdit): deny hand edits inside the generated Xcode project.
# XcodeGen writes *.xcodeproj (and the workspace inside it) from project.yml on every
# `make project`, so an edit there is lost on the next run and hides the change from review.
# Fails open when a helper is missing.
set -euo pipefail
lib="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/.claude/hooks/_lib.sh"
# shellcheck source=/dev/null # agent-ops ships _lib.sh beside this hook
{ [ -r "$lib" ] && source "$lib"; } 2>/dev/null || { cat >/dev/null 2>&1 || while IFS= read -r _; do :; done; echo "protect-xcodeproj.sh: shared helper unavailable; allowing this call." >&2; exit 0; }
input=$(cat 2>/dev/null) || { echo "protect-xcodeproj.sh: cannot read payload; allowing this call." >&2; exit 0; }
path=$(hook_get "$input" tool_input.file_path | head -n 1) || { echo "protect-xcodeproj.sh: unreadable payload; allowing this call." >&2; exit 0; }
case "$path" in
*.xcodeproj/* | *.xcodeproj | *.xcworkspace/* | *.xcworkspace | *.pbxproj)
  hook_deny "The Xcode project is generated from project.yml by XcodeGen. Change project.yml (targets, settings, schemes), then run make project."
  ;;
esac
exit 0
