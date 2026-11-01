#!/usr/bin/env bash
# PreToolUse: gen/ is generated from proto/ by `make generate`, buf runs as a
# `go tool` dependency pinned in go.mod, and the Connect modules are the /v2
# majors the generated code imports.
set -euo pipefail
if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"jq is not installed, so .claude/hooks/guard-grpc.sh cannot read this tool call and blocks it. Ask the user to install jq (brew install jq, or apt-get install jq), then retry."}}'
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

path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)" || exit 0
if [ -n "$path" ]; then
  root="${CLAUDE_PROJECT_DIR:-$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)}"
  case "$path" in /*) ;; *) path="$root/$path" ;; esac
  # Resolve . and .. so internal/../gen/x.go is caught too.
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
    gen/* | *.pb.go | *.connect.go)
      deny "gen/ is generated. Change the .proto file under proto/, run make generate, and commit both."
      ;;
  esac
fi

command="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)" || exit 0
[ -n "$command" ] || exit 0

buf_message="Run buf through go tool (make generate, make buf-lint, go tool buf ...), so its version and the plugins' come from go.mod. Don't call protoc directly, or run another buf binary."
v1_message="This project uses the Connect v2 modules (connectrpc.com/connect/v2, grpchealth/v2, grpcreflect/v2), which the generated code imports. Add the /v2 path."

while IFS= read -r line; do
  [ -n "$line" ] || continue
  if runs "$line" 'protoc|buf'; then
    deny "$buf_message"
  fi
  # buf from npm, or a go run or global install of it outside go.mod's tool.
  if { runs "$line" 'npx|bunx|pnpx|npm|pnpm|yarn|bun' && has "$line" '(^|[[:space:]])@bufbuild/buf(@[^[:space:]]*)?([[:space:]]|$)'; } ||
    { runs "$line" 'go' && has "$line" '^[^[:space:]]+[[:space:]]+(run|install)([[:space:]]|$)' && has "$line" 'github\.com/bufbuild/buf/cmd/'; }; then
    deny "$buf_message"
  fi
  # A Connect module path that isn't under /v2, from go get, go install or go mod edit.
  if runs "$line" 'go' && has "$line" '^[^[:space:]]+[[:space:]]+(get|install|mod[[:space:]]+edit)([[:space:]]|$)' &&
    printf '%s\n' "$line" | grep -Eo 'connectrpc\.com/(connect|grpchealth|grpcreflect)([^[:alnum:]_.-][^[:space:]]*)?([[:space:]]|$)' |
    grep -Evq '^connectrpc\.com/[a-z]+/v2([/@[:space:]]|$)'; then
    deny "$v1_message"
  fi
done < <(commands "$command")
exit 0
