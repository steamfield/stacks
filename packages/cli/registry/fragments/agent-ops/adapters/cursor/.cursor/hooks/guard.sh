#!/usr/bin/env bash
# Cursor hooks answer with {"permission": ...}, not hookSpecificOutput.
# https://cursor.com/docs/hooks
#
#   guard.sh        preToolUse: Shell goes to block-destructive.sh; Write goes to
#                   detect-secrets.sh; Delete of a real env file is denied.
#   guard.sh read   beforeReadFile: reading a real env file is denied.
#
# Cursor documents tool_input only for Shell, so a Write's path and text are
# read from every field name it may use. A Write that names no path or carries
# no text this script recognizes is allowed with a note on stderr.
set -euo pipefail
hook_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
lib="$hook_dir/../../.claude/hooks"
allow() { printf '{"permission":"allow"}\n'; }
skip() {
  echo "agent-ops: Cursor guard unavailable or unreadable payload/path; allowing call." >&2
  allow
  exit 0
}
[ -r "$lib/_lib.sh" ] || skip
source "$hook_dir/../../.claude/hooks/_lib.sh" 2>/dev/null || skip
input=$(cat) || skip
deny() {
  printf '{"permission":"deny","user_message":%s,"agent_message":%s}\n' \
    "$(json_quote "$1")" "$(json_quote "$1")"
}
# real_env <path>: the path is an env file holding real values.
real_env() {
  case "$(basename "$1")" in
  .env.example | .env.sample | .env.template) return 1 ;;
  .env | .env.* | .envrc) return 0 ;;
  esac
  return 1
}
# first <field>...: the first value found under tool_input.<field>.
first() {
  local field value
  for field in "$@"; do
    value=$(hook_get "$input" "tool_input.$field" | head -n 1)
    if [ -n "$value" ]; then
      printf '%s\n' "$value"
      return 0
    fi
  done
  return 1
}
env_reason="BLOCKED: env files hold real credentials, so agents don't read or change them.
Put the variable's name in .env.example and ask the user to set the value. Never work around this block."

if [ "${1:-}" = "read" ]; then
  path=$(hook_get "$input" file_path | head -n 1) || skip
  [ -n "$path" ] || skip
  if real_env "$path"; then deny "$env_reason"; else allow; fi
  exit 0
fi

tool=$(hook_get "$input" tool_name | head -n 1) || skip
[ -n "$tool" ] || skip
case "$tool" in
Shell)
  [ -r "$lib/block-destructive.sh" ] || skip
  project_root=$(cd "$hook_dir/../.." && pwd -P) || skip
  decision=$(printf '%s' "$input" | CLAUDE_PROJECT_DIR="$project_root" bash "$lib/block-destructive.sh") || skip
  ;;
Write)
  path=$(first file_path path) || skip
  texts() {
    hook_get "$input" tool_input.content
    hook_get "$input" tool_input.contents
    hook_get "$input" tool_input.new_string
    hook_get "$input" tool_input.edits.[].new_string
  }
  # The reader prints a line for every string it finds, even an empty one, so
  # no output at all means no text field.
  if [ "$(texts | wc -l)" -eq 0 ]; then
    skip
  fi
  payload=$(printf '{"tool_input":{"file_path":%s,"content":%s}}' \
    "$(json_quote "$path")" "$(json_quote "$(texts)")")
  [ -r "$lib/detect-secrets.sh" ] || skip
  decision=$(printf '%s' "$payload" | bash "$lib/detect-secrets.sh") || skip
  ;;
Delete)
  path=$(first file_path path) || skip
  if real_env "$path"; then deny "$env_reason"; else allow; fi
  exit 0
  ;;
*)
  allow
  exit 0
  ;;
esac

if [ -z "$decision" ]; then
  allow
else
  permission=$(hook_get "$decision" hookSpecificOutput.permissionDecision) || skip
  [ "$permission" = deny ] || skip
  reason=$(hook_get "$decision" hookSpecificOutput.permissionDecisionReason) || skip
  [ -n "$reason" ] || skip
  deny "$reason"
fi
