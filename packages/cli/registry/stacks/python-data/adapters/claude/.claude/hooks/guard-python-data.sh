#!/usr/bin/env bash
# PreToolUse (Bash|Edit|Write): raw data is input and processed data is output, so neither is
# hand-edited; dependencies go through uv add; marimo's editor and app servers stay with people.
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
  # A command starts a line or follows ; & | ( ` $( or sh -c; it may be quoted and sit behind
  # VAR=value, sudo, env, nice, exec, command, timeout 30, uv run --flags or uvx.
  q="[\"']?"
  start='(^|[;&|(`]|\$\(|[[:space:]]-c[[:space:]]+)[[:space:]]*\$?'"$q"
  assign='[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+'
  flags='([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*'
  wrapper="(sudo|command|exec|nice|env|uvx|uv[[:space:]]+run|timeout${flags}[[:space:]]+[0-9][^[:space:]]*)${flags}[[:space:]]+(${assign})*"
  prefix="${start}(${assign})*(${wrapper})*${q}"
  python='([^[:space:]]*/)?python[0-9.]*[[:space:]]+-m[[:space:]]+'
  # pip, pip3.12, a venv's pip, python -m pip and uv pip, with any flags before install.
  pip_install="${prefix}(uv[[:space:]]+pip|(${python}|([^[:space:]]*/)?)pip[0-9.]*)${q}${flags}[[:space:]]+install([[:space:]]|$)"
  # marimo or python -m marimo, with global flags before the subcommand.
  marimo_server="${prefix}(${python})?marimo${flags}[[:space:]]+(edit|run|new|tutorial)([[:space:]]|$)"
  if printf '%s\n' "$command" | grep -Eq "$pip_install"; then
    deny "pip install bypasses pyproject.toml and uv.lock. Use uv add <package> (uv add --dev for tools)."
  fi
  if printf '%s\n' "$command" | grep -Eq "$marimo_server"; then
    deny "marimo edit, run, new and tutorial start a server that waits for a browser. Run make notebooks to execute the notebooks headlessly, and ask the user to open the editor."
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
  data/raw/*)
    deny "data/raw/ holds input exactly as it arrived; never edit it. Handle bad rows with a rule in transform.py, or add a case to data/fixtures/orders.csv for tests."
    ;;
  data/processed/*)
    deny "data/processed/ is pipeline output. Change the transforms and run make pipeline."
    ;;
  uv.lock)
    deny "uv.lock is generated. Change dependencies with uv add or uv remove, or run uv lock."
    ;;
esac
