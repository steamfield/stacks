#!/usr/bin/env bash
# PreToolUse: gen/ is generated from proto/ by `make generate`, buf runs as a
# `go tool` dependency pinned in go.mod, and the Connect modules are the /v2
# majors the generated code imports.
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
    gen/* | *.pb.go | *.connect.go)
      deny "gen/ is generated. Change the .proto file under proto/, run make generate, and commit both."
      ;;
  esac
fi

command="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)" || exit 0
# A program at the start of a command or after ; & | ( or $(.
at_start='(^|[;&|(]|\$\()[[:space:]]*'
if printf '%s' "$command" | grep -Eq "${at_start}(protoc|buf)([[:space:]]|$)"; then
  deny "Run buf through go tool (make generate, make buf-lint, go tool buf ...), so its version and the plugins' come from go.mod. Don't call protoc directly."
fi
if printf '%s' "$command" | grep -Eq 'go[[:space:]]+(get|install)[[:space:]].*connectrpc\.com/(connect|grpchealth|grpcreflect)(@|/cmd/|[[:space:]]|$)'; then
  deny "This project uses the Connect v2 modules (connectrpc.com/connect/v2, grpchealth/v2, grpcreflect/v2), which the generated code imports. Add the /v2 path."
fi
exit 0
