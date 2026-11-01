#!/usr/bin/env bash
# PreToolUse: *_templ.go files are generated from .templ components by
# `make generate`, the vendored htmx file comes from `make htmx`, and templ runs
# as a `go tool` dependency so the CLI matches the runtime library in go.mod.
set -euo pipefail
if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"jq is not installed, so .claude/hooks/guard-htmx.sh cannot read this tool call and blocks it. Ask the user to install jq (brew install jq, or apt-get install jq), then retry."}}'
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

root="${CLAUDE_PROJECT_DIR:-$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)}"

path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)" || exit 0
if [ -n "$path" ]; then
  case "$path" in /*) ;; *) path="$root/$path" ;; esac
  # Resolve . and .. so internal/../static/vendor/htmx.min.js is caught too.
  normalize() {
    printf '%s\n' "$1" | awk '{
      n = split($0, part, "/"); m = 0
      for (i = 1; i <= n; i++) {
        if (part[i] == "" || part[i] == ".") continue
        if (part[i] == "..") { if (m > 0) m--; continue }
        kept[++m] = part[i]
      }
      out = ""; for (i = 1; i <= m; i++) out = out "/" kept[i]; print out
    }'
  }
  path="$(normalize "$path")"
  relative="${path#"$(normalize "$root")"/}"
  case "$relative" in
    *_templ.go)
      deny "*_templ.go files are generated. Edit the .templ file beside it, run make generate, and commit both."
      ;;
    static/vendor/*)
      deny "static/vendor/ holds the htmx release make htmx downloads and checks. Run make htmx (HTMX_VERSION=<version> for a specific one) instead of editing it."
      ;;
  esac
fi

command="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)" || exit 0
[ -n "$command" ] || exit 0

templ_cmd='github\.com/a-h/templ/cmd/templ([@[:space:]]|$)'
while IFS= read -r line; do
  [ -n "$line" ] || continue
  # The templ binary by any path, or the templ CLI run from its module.
  if runs "$line" 'templ' ||
    { runs "$line" 'go' && has "$line" '^[^[:space:]]+[[:space:]]+run([[:space:]]|$)' && has "$line" "$templ_cmd"; }; then
    deny "Run templ through go tool (make generate, make fmt, go tool templ ...), so the CLI version matches the templ library in go.mod."
  fi
  if runs "$line" 'go' && has "$line" '^[^[:space:]]+[[:space:]]+install([[:space:]]|$)' && has "$line" "$templ_cmd"; then
    deny "Don't install templ globally; a global CLI drifts from the runtime in go.mod. It is a go tool dependency: go get -tool github.com/a-h/templ/cmd/templ."
  fi
done < <(commands "$command")
exit 0
