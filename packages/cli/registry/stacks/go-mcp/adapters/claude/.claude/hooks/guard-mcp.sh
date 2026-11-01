#!/usr/bin/env bash
# PreToolUse: stop three ways of "testing" the server that mislead an agent.
# JSON-RPC fed to it on stdin (a pipe, a file redirect or a heredoc) gets no
# answer (the server stops when stdin closes, before it replies), the MCP
# Inspector's web UI waits forever, and a second Go MCP SDK mixes two
# incompatible APIs into the module.
set -euo pipefail
if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"jq is not installed, so .claude/hooks/guard-mcp.sh cannot read this tool call and blocks it. Ask the user to install jq (brew install jq, or apt-get install jq), then retry."}}'
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

command="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)" || exit 0
[ -n "$command" ] || exit 0

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
# server <line>: the line runs the built server (bin/<name> by a relative,
# $PWD, $CLAUDE_PROJECT_DIR or absolute project path) or `go run` of the root package.
server() {
  local program="${1%%[[:space:]]*}"
  case "$program" in
    "$root"/bin/*) return 0 ;;
  esac
  has "$program" '^(\./|\$\{?(PWD|CLAUDE_PROJECT_DIR)\}?/)?bin/[^/]+$' ||
    { runs "$1" 'go' && has "$1" '^[^[:space:]]+[[:space:]]+run([[:space:]]+-[^[:space:]]+)*[[:space:]]+(\./?|(\./)?main\.go)([[:space:]]|$)'; }
}

stdin_message="The server stops when stdin closes, before it answers, so JSON-RPC fed to it on stdin (a pipe, a file or a heredoc) prints nothing. Use make call (TOOL=<name> ARGS='<json>' to call one tool), make smoke, or a test with mcp.NewInMemoryTransports."

# Input redirected into the server: < file, << heredoc or <<< string. An empty
# stdin (< /dev/null) only checks that it exits, which is fine.
while IFS= read -r line; do
  [ -n "$line" ] || continue
  if server "$line" && has "$line" '<' && ! has "$line" '<[[:space:]]*/dev/null([[:space:]]|$)'; then
    deny "$stdin_message"
  fi
  if runs "$line" 'go' && has "$line" '^[^[:space:]]+[[:space:]]+(get|install|mod[[:space:]]+edit)[[:space:]].*(github\.com/mark3labs/mcp-go|github\.com/metoro-io/mcp-golang)'; then
    deny "This project uses the official SDK, github.com/modelcontextprotocol/go-sdk. Don't add a second MCP library; its types don't mix with mcp.Server."
  fi
done < <(commands "$command")

# Input piped into the server: any stage after the first of a pipeline.
pipelines="$(printf '%s\n' "$command" | awk '{ gsub(/\|\||&&|[;&]/, "\n"); print }')"
while IFS= read -r pipeline; do
  case "$pipeline" in *"|"*) ;; *) continue ;; esac
  rest="${pipeline#*|}"
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    if server "$line"; then
      deny "$stdin_message"
    fi
  done < <(commands "$rest")
done <<<"$pipelines"

# The Inspector without --cli serves a web UI and never returns.
if has "$command" '@modelcontextprotocol/inspector' && ! has "$command" '(^|[[:space:]])--cli([[:space:]]|$)'; then
  deny "The MCP Inspector's web UI waits for a browser and hangs this shell. Use make call, or the Inspector's --cli mode; ask the user to open the UI themselves."
fi
exit 0
