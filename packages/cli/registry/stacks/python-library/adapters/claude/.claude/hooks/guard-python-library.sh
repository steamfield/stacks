#!/usr/bin/env bash
# PreToolUse (Bash|Edit|Write): dependencies go through uv add, uv.lock and dist/ stay generated,
# and pytest never imports the working tree. (agent-ops's block-destructive.sh denies uploads.)
set -euo pipefail
command -v jq >/dev/null 2>&1 || exit 0

input="$(cat)"

deny() {
  jq -n --arg reason "$1" '{hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }}'
  exit 0
}

command="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)" || exit 0
if [ -n "$command" ]; then
  # pip, pip3, python -m pip and uv pip, at the start of a line or after ; & | or (.
  pip_install='(^|[;&|(])[[:space:]]*((uv|python3?[[:space:]]+-m)[[:space:]]+)?pip3?[[:space:]]+install([[:space:]]|$)'
  if printf '%s\n' "$command" | grep -Eq "$pip_install"; then
    deny "pip install bypasses pyproject.toml and uv.lock. Use uv add <package> (uv add --dev for tools), or make smoke to try the built wheel."
  fi
  exit 0
fi

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd -P)}"
physical="$(cd "$root" 2>/dev/null && pwd -P)" || physical="$root"
# Normalize dot segments and recognize both logical and physical project roots.
rel="$(printf '%s' "$input" | jq -r --arg root "$root" --arg physical "$physical" '
  def normalize:
    split("/") | reduce .[] as $part ([];
      if $part == "" or $part == "." then .
      elif $part == ".." and length > 0 and .[-1] != ".." then .[:-1]
      else . + [$part] end) | join("/");
  .tool_input.file_path | select(type == "string" and length > 0) as $path |
  ($path | normalize) as $file |
  ($root | normalize) as $logical |
  ($physical | normalize) as $real |
  if ($path | startswith("/")) then
    if ($file | startswith($logical + "/")) then $file[($logical | length) + 1:]
    elif ($file | startswith($real + "/")) then $file[($real | length) + 1:]
    else empty end
  else $file end
' 2>/dev/null)" || exit 0

case "$rel" in
  uv.lock)
    deny "uv.lock is generated. Change dependencies with uv add or uv remove, or run uv lock."
    ;;
  dist/*)
    deny "dist/ is build output. Change the source and run make build."
    ;;
  pyproject.toml)
    added="$(printf '%s' "$input" | jq -r '.tool_input.new_string // .tool_input.content // empty' 2>/dev/null)" || exit 0
    if printf '%s\n' "$added" | grep -Eq '^[[:space:]]*pythonpath[[:space:]]*='; then
      deny "pythonpath makes pytest import src/ instead of the installed package, which hides packaging bugs. Run make install so the package is installed in .venv."
    fi
    ;;
esac
