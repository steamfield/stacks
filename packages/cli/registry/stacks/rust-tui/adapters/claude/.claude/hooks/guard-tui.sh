#!/usr/bin/env bash
# PreToolUse (Bash|Edit|Write|MultiEdit): frame snapshots are accepted with
# `make snapshots`, Cargo.lock and target/ are written by cargo, and the
# full-screen UI must never get a fake terminal inside the agent's shell, where
# it waits for keys nobody sends and the session hangs. Deny each with the fix.
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
  # A pseudo-terminal wrapper at the start of a command or after ; & | ( or $(.
  if printf '%s\n' "$command" | grep -Eq '(^|[;&|(]|\$\()[[:space:]]*(script|unbuffer|tmux|screen)([[:space:]]|$)'; then
    deny "Don't run the UI under a fake terminal. Test it with make test (frame snapshots and the headless event loop), use --no-tui or --json for output, or ask the user to run it in their terminal."
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
  *.snap | *.snap.new | *.pending-snap)
    deny "Frame snapshots are generated. Change the view, run make snapshots, and review the diff with the user."
    ;;
  Cargo.lock | */Cargo.lock)
    deny "Cargo.lock is written by cargo. Change dependencies with cargo add, cargo remove or cargo update -p <crate>."
    ;;
  target/*)
    deny "target/ is cargo's build output. Edit the source and rebuild."
    ;;
esac
