#!/usr/bin/env bash
# PreToolUse (Bash|Edit|Write): dependencies go through uv add, uv.lock and dist/ stay generated,
# and pytest's settings stay in pyproject.toml. (agent-ops's block-destructive.sh denies uploads.)
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
  pytest.ini | .pytest.ini | pytest.toml | .pytest.toml)
    deny "pytest reads the first config file it finds, so $rel would replace [tool.pytest.ini_options] in pyproject.toml and drop filterwarnings = [\"error\"], --strict-config and the import mode. Keep pytest settings in pyproject.toml; for an import error, run make install."
    ;;
esac
