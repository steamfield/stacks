#!/usr/bin/env bash
# PreToolUse (Bash): stop three commands that look right in a Go library and
# aren't. `go test -fuzz` without -fuzztime runs until it finds a failure, which
# may be never; `go get -tool` without -modfile puts the tool in go.mod, where
# every module that imports this one inherits its requirements; and rewriting
# the API baseline accepts a breaking change, which is the user's decision.
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
[ -n "$command" ] || exit 0

# Each check looks at one shell command at a time, split on ; & | and newlines.
segments="$(printf '%s\n' "$command" | awk '{ gsub(/[;&|]/, "\n"); print }')"

while IFS= read -r segment; do
  if printf '%s' "$segment" | grep -Eq '(^|[[:space:]])go[[:space:]]+test([[:space:]]|$)' &&
    printf '%s' "$segment" | grep -Eq '[[:space:]]--?(test\.)?fuzz([=[:space:]]|$)' &&
    ! printf '%s' "$segment" | grep -Eq '[[:space:]]--?(test\.)?fuzztime([=[:space:]]|$)'; then
    deny "go test -fuzz without -fuzztime runs until it finds a failure, which can be forever. Run make fuzz (FUZZTIME=30s for longer), or add -fuzztime 30s and -run '^\$' to the command."
  fi
  if printf '%s' "$segment" | grep -Eq '(^|[[:space:]])go[[:space:]]+get([[:space:]].*)?[[:space:]]-tool([[:space:]]|$)' &&
    ! printf '%s' "$segment" | grep -Eq '[[:space:]]-modfile[=[:space:]]+tools\.mod([[:space:]]|$)'; then
    deny "Dev tools live in tools.mod, not go.mod, because go.mod's requirements reach every module that imports this library. Run go get -modfile=tools.mod -tool <package> and call it with go tool -modfile=tools.mod <name>."
  fi
done <<<"$segments"

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
if [ -f "$root/api/baseline.export" ] &&
  printf '%s\n' "$segments" | grep -Eq '(^|[[:space:]])(make([[:space:]].*)?[[:space:]]api-baseline([[:space:]]|$)|.*apidiff([[:space:]].*)?[[:space:]]-w([=[:space:]]|$))'; then
  deny "Rewriting api/baseline.export accepts every incompatible API change make api-check reports. Keep the old API working instead, or tell the user what breaks and ask them to run make api-baseline as part of a breaking release (docs/releasing.md)."
fi
exit 0
