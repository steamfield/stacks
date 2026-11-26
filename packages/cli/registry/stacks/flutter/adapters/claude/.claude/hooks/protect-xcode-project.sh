#!/usr/bin/env bash
# PreToolUse (Edit|Write|MultiEdit): deny hand edits to the Xcode project and
# workspace under ios/. flutter create wrote them, and Flutter, Swift Package
# Manager and CocoaPods rewrite project.pbxproj, the schemes and the workspace,
# so a text edit is lost or conflicts on their next pass. Info.plist,
# AppDelegate.swift and the Podfile stay editable. Fails open with a note.
set -euo pipefail
lib="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/.claude/hooks/_lib.sh"
# agent-ops ships _lib.sh beside this hook.
# shellcheck source=/dev/null
{ [ -r "$lib" ] && source "$lib"; } 2>/dev/null || { cat >/dev/null 2>&1 || while IFS= read -r _; do :; done; echo "protect-xcode-project.sh: shared helper unavailable; allowing this call." >&2; exit 0; }
input=$(cat 2>/dev/null) || { echo "protect-xcode-project.sh: cannot read payload; allowing this call." >&2; exit 0; }
path=$(hook_get "$input" tool_input.file_path | head -n 1) || { echo "protect-xcode-project.sh: unreadable payload; allowing this call." >&2; exit 0; }
case "$path" in
*.pbxproj | *.xcodeproj/* | *.xcworkspace/*)
  hook_deny "Flutter, Swift Package Manager and CocoaPods own the Xcode project and workspace under ios/. Change them through Flutter (flutter pub add for a plugin, then a build) or ask the user to make the change in Xcode."
  ;;
esac
exit 0
