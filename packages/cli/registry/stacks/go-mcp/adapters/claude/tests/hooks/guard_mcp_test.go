// Package hooks tests the Claude Code hooks under .claude/hooks.
package hooks

import (
	"encoding/json"
	"os"
	"os/exec"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const hook = "../../.claude/hooks/guard-mcp.sh"

const projectDir = "/work/project"

// run runs the hook on command with PATH as given and returns "allow" or the
// hook's decision and reason.
func run(t *testing.T, path, command string) (string, string) {
	t.Helper()
	bash, err := exec.LookPath("bash")
	require.NoError(t, err)
	payload, err := json.Marshal(map[string]any{"tool_input": map[string]string{"command": command}})
	require.NoError(t, err)
	cmd := exec.Command(bash, hook)
	cmd.Stdin = strings.NewReader(string(payload))
	cmd.Env = append(os.Environ(), "CLAUDE_PROJECT_DIR="+projectDir, "PATH="+path)
	out, err := cmd.Output()
	require.NoError(t, err)
	if len(out) == 0 {
		return "allow", ""
	}
	var result struct {
		HookSpecificOutput struct{ PermissionDecision, PermissionDecisionReason string }
	}
	require.NoError(t, json.Unmarshal(out, &result))
	assert.NotEmpty(t, result.HookSpecificOutput.PermissionDecisionReason)
	return result.HookSpecificOutput.PermissionDecision, result.HookSpecificOutput.PermissionDecisionReason
}

// decide runs the hook with this PATH, which must have jq: without it the hook
// blocks everything, so a missing jq fails the test rather than skipping it.
func decide(t *testing.T, command string) string {
	t.Helper()
	if _, err := exec.LookPath("jq"); err != nil {
		t.Fatal("jq is not installed; the hook needs it (brew install jq, or apt-get install jq)")
	}
	decision, _ := run(t, os.Getenv("PATH"), command)
	return decision
}

func TestDeniesMisleadingCommands(t *testing.T) {
	for _, command := range []string{
		`echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | ./bin/server`,
		"cat request.json | bin/server --log-level debug",
		"printf '%s\\n' \"$init\" | go run .",
		"cat request.json | go run ./",
		"cat request.json | go run main.go",
		"cat request.json | $PWD/bin/server",
		"cat request.json | /work/project/bin/server",
		"cat request.json | env ./bin/server",
		"cat request.json | sh -c './bin/server'",
		"make build && cat request.json | ./bin/server",
		"./bin/server < request.json",
		"./bin/server <request.json",
		"./bin/server <<< '{}'",
		"go run . < request.json",
		"./bin/server <<EOF\n{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}\nEOF",
		"npx @modelcontextprotocol/inspector ./bin/server",
		"bunx @modelcontextprotocol/inspector@latest go run .",
		"go get github.com/mark3labs/mcp-go@latest",
		"go get github.com/metoro-io/mcp-golang",
		"go mod edit -require=github.com/mark3labs/mcp-go@v0.1.0",
	} {
		assert.Equal(t, "deny", decide(t, command), command)
	}
}

func TestAllowsTheShippedWays(t *testing.T) {
	for _, command := range []string{
		"make call",
		"make call TOOL=convert_units ARGS='{\"value\": 1, \"from\": \"m\", \"to\": \"ft\"}'",
		"make smoke",
		"make build && ./bin/server --version",
		"./bin/server < /dev/null",
		"go run ./cmd/mcpcall ./bin/server",
		"go run ./cmd/mcpcall -call convert_units -args '{}' ./bin/server",
		"npx @modelcontextprotocol/inspector --cli ./bin/server --method tools/list",
		"go get github.com/modelcontextprotocol/go-sdk",
		"ls bin/ | wc -l",
		"cat request.json | /usr/bin/wc -l",
		"cat request.json | jq .",
		"go test -race ./internal/server/ 2>&1 | tail -n 20",
		"go run ./cmd/mcpcall ./bin/server | jq .",
	} {
		assert.Equal(t, "allow", decide(t, command), command)
	}
}

func TestBlocksEverythingWithoutJq(t *testing.T) {
	decision, reason := run(t, t.TempDir(), "go test ./...")
	assert.Equal(t, "deny", decision)
	assert.Contains(t, reason, "jq")
}
