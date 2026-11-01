#!/usr/bin/env bash
# PreToolUse (Bash|Edit|Write): dependencies go through uv add, a foreground Streamlit server
# would hang the session (AppTest runs the page instead), and uv.lock and secrets aren't hand-written.
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
  # streamlit or python -m streamlit, with global flags before the subcommand.
  streamlit_server="${prefix}(${python})?streamlit${flags}[[:space:]]+(run|hello)([[:space:]]|$)"
  # make dev or make start, also with flags (-C .) or other targets before them.
  make_server="${prefix}make${flags}([[:space:]]+[^-[:space:];&|][^[:space:];&|]*)*[[:space:]]+(dev|start)([[:space:]]|$)"
  if printf '%s\n' "$command" | grep -Eq "$pip_install"; then
    deny "pip install bypasses pyproject.toml and uv.lock. Use uv add <package> (uv add --dev for tools)."
  fi
  if printf '%s\n' "$command" | grep -Eq "$streamlit_server|$make_server"; then
    deny "streamlit run, make dev and make start keep a server in the foreground. Run make test: tests/test_app.py drives the page with AppTest. stacks verify serves and probes it; ask the user to run make dev to look at it."
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
  .streamlit/secrets.toml)
    deny ".streamlit/secrets.toml holds the user's credentials. Read settings from the environment in config.py, and ask the user to fill secrets themselves."
    ;;
esac
