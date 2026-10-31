// Package hooks tests the Claude Code hooks under .claude/hooks.
package hooks

import (
	"encoding/json"
	"os/exec"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const hook = "../../.claude/hooks/guard-mcp.sh"

func decide(t *testing.T, command string) string {
	t.Helper()
	if _, err := exec.LookPath("jq"); err != nil {
		t.Skip("jq is not installed; the hook allows everything without it")
	}
	payload, err := json.Marshal(map[string]any{"tool_input": map[string]string{"command": command}})
	require.NoError(t, err)
	cmd := exec.Command("bash", hook)
	cmd.Stdin = strings.NewReader(string(payload))
	out, err := cmd.Output()
	require.NoError(t, err)
	if len(out) == 0 {
		return "allow"
	}
	var result struct {
		HookSpecificOutput struct{ PermissionDecision, PermissionDecisionReason string }
	}
	require.NoError(t, json.Unmarshal(out, &result))
	assert.NotEmpty(t, result.HookSpecificOutput.PermissionDecisionReason)
	return result.HookSpecificOutput.PermissionDecision
}

func TestDeniesMisleadingCommands(t *testing.T) {
	for _, command := range []string{
		`echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | ./bin/server`,
		"cat request.json | bin/server --log-level debug",
		"printf '%s\\n' \"$init\" | go run .",
		"npx @modelcontextprotocol/inspector ./bin/server",
		"bunx @modelcontextprotocol/inspector@latest go run .",
		"go get github.com/mark3labs/mcp-go@latest",
		"go get github.com/metoro-io/mcp-golang",
	} {
		assert.Equal(t, "deny", decide(t, command), command)
	}
}

func TestAllowsTheShippedWays(t *testing.T) {
	for _, command := range []string{
		"make call TOOL=convert_units ARGS='{\"value\": 1, \"from\": \"m\", \"to\": \"ft\"}'",
		"make build && ./bin/server --version",
		"go run ./cmd/mcpcall ./bin/server",
		"npx @modelcontextprotocol/inspector --cli ./bin/server --method tools/list",
		"go get github.com/modelcontextprotocol/go-sdk",
		"ls bin/ | wc -l",
		"go test -race ./internal/server/",
	} {
		assert.Equal(t, "allow", decide(t, command), command)
	}
}
