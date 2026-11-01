#!/usr/bin/env bash
# PreToolUse: stop the commands and edits that look right in a Go library and
# aren't. `go test -fuzz` without a -fuzztime limit runs until it finds a
# failure, which may be never; `go get -tool` without -modfile puts the tool in
# go.mod, where every module that imports this one inherits its requirements;
# and rewriting, editing or removing the API baseline accepts a breaking
# change, which is the user's decision.
set -euo pipefail
if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"jq is not installed, so .claude/hooks/guard-library.sh cannot read this tool call and blocks it. Ask the user to install jq (brew install jq, or apt-get install jq), then retry."}}'
  exit 0
fi

input="$(cat)"

deny() {
  jq -n --arg reason "$1" '{hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }}'
  exit 0
}

# commands <text>: one line per simple command, split on ; & | ( ) { } $( `
# and newlines, with quotes and backslashes removed, and leading wrappers (env,
# command, exec, nice, sudo, time, timeout, xargs, sh -c, bash -c ...) and
# VAR=value assignments dropped, so each line starts with the program.
commands() {
  printf '%s\n' "$1" | LC_ALL=C awk '
    {
      gsub(/\$\047/, "\047"); gsub(/\$"/, "\"")
      gsub(/[\047"\\]/, "")
      gsub(/\$\(|[`;&|(){}]/, "\n")
      n = split($0, parts, "\n")
      for (p = 1; p <= n; p++) {
        m = split(parts[p], w, /[ \t]+/)
        out = ""; wrapped = 0; started = 0
        for (i = 1; i <= m; i++) {
          if (w[i] == "") continue
          if (!started) {
            if (w[i] ~ /^[A-Za-z_][A-Za-z0-9_]*=/) continue
            base = w[i]; sub(/.*\//, "", base)
            if (base ~ /^(env|command|builtin|exec|nice|nohup|sudo|doas|time|timeout|xargs|busybox|stdbuf|sh|bash|zsh|dash|ksh)$/) { wrapped = 1; continue }
            if (wrapped && (w[i] ~ /^-/ || w[i] ~ /^[0-9][0-9.]*[smhd]?$/)) continue
            started = 1
          }
          out = out (out == "" ? "" : " ") w[i]
        }
        if (out != "") print out
      }
    }'
}

# runs <line> <names>: the line's program is one of names (an ERE), by basename.
runs() { printf '%s\n' "$1" | grep -Eq "^([^[:space:]]*/)?($2)([[:space:]]|$)"; }
has() { printf '%s\n' "$1" | grep -Eq "$2"; }

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
baseline_message="api/baseline.export is the API of the last release, which make api-check compares against. Changing or removing it accepts every incompatible change since. Keep the old API working instead, or tell the user what breaks and ask them to run make api-baseline as part of a breaking release (docs/releasing.md)."

path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)" || exit 0
if [ -n "$path" ]; then
  case "$path" in /*) ;; *) path="$root/$path" ;; esac
  # Resolve . and .. so api/../api/baseline.export is caught too.
  path="$(printf '%s\n' "$path" | awk '{
    n = split($0, part, "/"); m = 0
    for (i = 1; i <= n; i++) {
      if (part[i] == "" || part[i] == ".") continue
      if (part[i] == "..") { if (m > 0) m--; continue }
      kept[++m] = part[i]
    }
    out = ""; for (i = 1; i <= m; i++) out = out "/" kept[i]; print out
  }')"
  case "$path" in
    */api/baseline.export) deny "$baseline_message" ;;
  esac
fi

command="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)" || exit 0
[ -n "$command" ] || exit 0

# A missing baseline is the first one only if git has never tracked it: one
# deleted from the worktree, the index or a commit still counts as existing.
baseline_exists() {
  [ -e "$root/api/baseline.export" ] && return 0
  git -C "$root" ls-files --error-unmatch api/baseline.export >/dev/null 2>&1 && return 0
  [ -n "$(git -C "$root" log --all --format=%H -1 -- api/baseline.export 2>/dev/null)" ]
}

baseline='(^|[[:space:]/=])(api/)?baseline\.export([[:space:]]|$)'
api_dir='(^|[[:space:]])(\./)?api/?([[:space:]]|$)'
fuzztime='[[:space:]]--?(test\.)?fuzztime([=[:space:]]|$)'
zero_fuzztime='[[:space:]]--?(test\.)?fuzztime[=[:space:]]+0+(\.0*)?(ns|us|ms|s|m|h|x)?([[:space:]]|$)'

while IFS= read -r line; do
  [ -n "$line" ] || continue
  if runs "$line" 'go' && has "$line" '^[^[:space:]]+[[:space:]]+test([[:space:]]|$)' &&
    has "$line" '[[:space:]]--?(test\.)?fuzz([=[:space:]]|$)' &&
    { ! has "$line" "$fuzztime" || has "$line" "$zero_fuzztime"; }; then
    deny "go test -fuzz without a -fuzztime limit (0 means none) runs until it finds a failure, which can be forever. Run make fuzz (FUZZTIME=30s for longer), or add -fuzztime 30s and -run '^\$' to the command."
  fi
  if runs "$line" 'go' && has "$line" '^[^[:space:]]+[[:space:]]+get([[:space:]].*)?[[:space:]]-tool([[:space:]]|$)' &&
    ! has "$line" '[[:space:]]-modfile[=[:space:]]+tools\.mod([[:space:]]|$)'; then
    deny "Dev tools live in tools.mod, not go.mod, because go.mod's requirements reach every module that imports this library. Run go get -modfile=tools.mod -tool <package> and call it with go tool -modfile=tools.mod <name>."
  fi
  # Removing, moving or overwriting the baseline, or redirecting into it.
  if { runs "$line" 'rm|unlink|shred|truncate|mv|tee|dd' && has "$line" "$baseline|$api_dir"; } ||
    { runs "$line" 'git' && has "$line" '^[^[:space:]]+[[:space:]]+(rm|mv)([[:space:]]|$)' && has "$line" "$baseline|$api_dir"; } ||
    { runs "$line" 'cp|install|ln|rsync' && has "${line##*[[:space:]]}" "$baseline|$api_dir"; } ||
    { runs "$line" 'sed|perl' && has "$line" '[[:space:]]-[a-zA-Z]*i' && has "$line" "$baseline"; } ||
    has "$line" '>[>]?[[:space:]]*([^[:space:]]*/)?(api/)?baseline\.export([[:space:]]|$)'; then
    deny "$baseline_message"
  fi
  # Recording a new baseline over one that exists or was ever committed.
  if { { runs "$line" 'g?make' && has "$line" '[[:space:]]api-baseline([[:space:]]|$)'; } ||
    { has "$line" '(^|[[:space:]/])apidiff([[:space:]]|$)' && has "$line" '[[:space:]]-w([=[:space:]]|$)'; }; } &&
    baseline_exists; then
    deny "$baseline_message"
  fi
done < <(commands "$command")
exit 0
