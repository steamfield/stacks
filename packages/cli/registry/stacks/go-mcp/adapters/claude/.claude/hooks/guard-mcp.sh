#!/usr/bin/env bash
# PreToolUse: stop three ways of "testing" the server that mislead an agent.
# Piped JSON-RPC gets no answer (the server stops when stdin closes, before it
# replies), the MCP Inspector's web UI waits forever, and a second Go MCP SDK
# mixes two incompatible APIs into the module.
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

# Input piped into the built server, or into `go run .`.
if printf '%s' "$command" | grep -Eq '\|[[:space:]]*(\./)?bin/|\|[[:space:]]*go[[:space:]]+run[[:space:]]+\.([[:space:]]|$)'; then
  deny "The server stops when stdin closes, before it answers, so piped JSON-RPC prints nothing. Use make call (TOOL=<name> ARGS='<json>' to call one tool), make smoke, or a test with mcp.NewInMemoryTransports."
fi
# The Inspector without --cli serves a web UI and never returns.
if printf '%s' "$command" | grep -q '@modelcontextprotocol/inspector' && ! printf '%s' "$command" | grep -Eq '(^|[[:space:]])--cli([[:space:]]|$)'; then
  deny "The MCP Inspector's web UI waits for a browser and hangs this shell. Use make call, or the Inspector's --cli mode; ask the user to open the UI themselves."
fi
if printf '%s' "$command" | grep -Eq 'go[[:space:]]+(get|install)[[:space:]].*(github\.com/mark3labs/mcp-go|github\.com/metoro-io/mcp-golang)'; then
  deny "This project uses the official SDK, github.com/modelcontextprotocol/go-sdk. Don't add a second MCP library; its types don't mix with mcp.Server."
fi
exit 0
