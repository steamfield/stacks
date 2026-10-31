#!/usr/bin/env bash
# PostToolUse (Edit|Write): regenerate the component after a .templ edit, so Go
# code never compiles against the previous version of it. A syntax error goes
# back to the agent as context. Quiet when jq or go is missing.
set -euo pipefail
command -v jq >/dev/null 2>&1 || exit 0
command -v go >/dev/null 2>&1 || exit 0

input="$(cat)"
path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)" || exit 0
case "$path" in
  *.templ) ;;
  *) exit 0 ;;
esac
[ -f "$path" ] || exit 0
root="${CLAUDE_PROJECT_DIR:-$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)}"
[ -n "$root" ] && [ -f "$root/go.mod" ] || exit 0

rc=0
out="$(cd "$root" && go tool templ generate -log-level error -f "$path" 2>&1)" || rc=$?
[ "$rc" -eq 0 ] && exit 0
jq -n --arg context "templ generate failed for ${path#"$root"/}. Fix the component before moving on:
$(printf '%s' "$out" | head -n 40)" '{hookSpecificOutput: {
  hookEventName: "PostToolUse",
  additionalContext: $context
}}'
exit 0
