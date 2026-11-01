#!/usr/bin/env bash
# PreToolUse: *_templ.go files are generated from .templ components by
# `make generate`, the vendored htmx file comes from `make htmx`, and templ runs
# as a `go tool` dependency so the CLI matches the runtime library in go.mod.
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

path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)" || exit 0
if [ -n "$path" ]; then
  root="${CLAUDE_PROJECT_DIR:-$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)}"
  relative="${path#"$root"/}"
  case "$relative" in
    *_templ.go)
      deny "*_templ.go files are generated. Edit the .templ file beside it, run make generate, and commit both."
      ;;
    static/vendor/*)
      deny "static/vendor/ holds the downloaded htmx release. Run make htmx (HTMX_VERSION=<version> for a specific one) instead of editing it."
      ;;
  esac
fi

command="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)" || exit 0
# A program at the start of a command or after ; & | ( or $(.
at_start='(^|[;&|(]|\$\()[[:space:]]*'
if printf '%s' "$command" | grep -Eq "${at_start}templ([[:space:]]|$)"; then
  deny "Run templ through go tool (make generate, make fmt, go tool templ ...), so the CLI version matches the templ library in go.mod."
fi
if printf '%s' "$command" | grep -Eq 'go[[:space:]]+install[[:space:]].*github\.com/a-h/templ/cmd/templ'; then
  deny "Don't install templ globally; a global CLI drifts from the runtime in go.mod. It is a go tool dependency: go get -tool github.com/a-h/templ/cmd/templ."
fi
exit 0
