#!/usr/bin/env bash
# PreToolUse (Bash|Edit|Write): `cargo test --all-targets` silently skips the
# doctests that prove every public example, and Cargo.lock and target/ are
# written by cargo. Deny each and say what to run instead.
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
  # cargo test (optionally cargo +toolchain test) with --all-targets in the same
  # command, at the start of a line or after ; & | ( or $(.
  all_targets='(^|[;&|(]|\$\()[[:space:]]*cargo([[:space:]]+\+[^[:space:]]+)?[[:space:]]+test([[:space:]][^;&|]*)?[[:space:]]--all-targets([[:space:]]|$)'
  if printf '%s\n' "$command" | grep -Eq "$all_targets"; then
    deny "cargo test --all-targets skips doctests, which are this crate's public examples. Run make test, or cargo test --all-features (add a test name to narrow it)."
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
  Cargo.lock | */Cargo.lock)
    deny "Cargo.lock is written by cargo. Change dependencies with cargo add, cargo remove or cargo update -p <crate>."
    ;;
  target/*)
    deny "target/ is cargo's build output, including the .crate make package writes. Edit the source and rebuild."
    ;;
esac
