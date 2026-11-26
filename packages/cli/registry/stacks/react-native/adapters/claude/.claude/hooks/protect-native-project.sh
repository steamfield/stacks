#!/usr/bin/env bash
# PreToolUse (Edit|Write): deny hand edits to files Xcode and CocoaPods own: *.pbxproj and the
# rest of *.xcodeproj, *.xcworkspace contents, ios/Pods/ and Podfile.lock. The committed project
# file changes only through Xcode or `bun run pods`; new native code goes in a local module under
# modules/, which autolinking adds without touching it. Fails open when the payload is unreadable.
set -euo pipefail
lib="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/.claude/hooks/_lib.sh"
# shellcheck source=/dev/null # agent-ops ships _lib.sh beside this hook
{ [ -r "$lib" ] && source "$lib"; } 2>/dev/null || { cat >/dev/null 2>&1 || while IFS= read -r _; do :; done; echo "protect-native-project.sh: shared helper unavailable; allowing this call." >&2; exit 0; }
input=$(cat 2>/dev/null) || { echo "protect-native-project.sh: cannot read payload; allowing this call." >&2; exit 0; }

file_path=$(hook_get "$input" tool_input.file_path | head -n 1) || exit 0
[ -n "$file_path" ] || exit 0

case "$file_path" in
*.xcodeproj/* | *.xcworkspace/* | */Pods/* | Pods/* | */Podfile.lock | Podfile.lock)
  hook_deny "$(basename "$file_path") is owned by Xcode or CocoaPods. Put native code in a local module under modules/ and run bun run pods; for a project setting, ask the user to change it in Xcode."
  ;;
esac
exit 0
