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

const hook = "../../.claude/hooks/guard-grpc.sh"

func decide(t *testing.T, input map[string]any) string {
	t.Helper()
	if _, err := exec.LookPath("jq"); err != nil {
		t.Skip("jq is not installed; the hook allows everything without it")
	}
	payload, err := json.Marshal(input)
	require.NoError(t, err)
	cmd := exec.Command("bash", hook)
	cmd.Env = append(os.Environ(), "CLAUDE_PROJECT_DIR=/work/project")
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

func file(path string) map[string]any {
	return map[string]any{"tool_input": map[string]string{"file_path": path}}
}

func command(line string) map[string]any {
	return map[string]any{"tool_input": map[string]string{"command": line}}
}

func TestGeneratedCodeIsNotEdited(t *testing.T) {
	for _, path := range []string{
		"gen/notes/v1/notes.pb.go",
		"/work/project/gen/notes/v1/notesv1connect/notes.connect.go",
		"/work/project/gen/README.md",
		"internal/other/thing.pb.go",
	} {
		assert.Equal(t, "deny", decide(t, file(path)), path)
	}
	for _, path := range []string{
		"proto/notes/v1/notes.proto",
		"/work/project/internal/rpc/notes.go",
		"/work/project/internal/gen/helper.go",
		"/elsewhere/gen/notes.go",
	} {
		assert.Equal(t, "allow", decide(t, file(path)), path)
	}
}

func TestBufRunsThroughGoTool(t *testing.T) {
	for _, line := range []string{
		"buf generate",
		"buf lint && make test",
		"protoc --go_out=gen proto/notes/v1/notes.proto",
		"make build; buf breaking --against .git#branch=main",
		"echo $(buf --version)",
	} {
		assert.Equal(t, "deny", decide(t, command(line)), line)
	}
	for _, line := range []string{
		"go tool buf lint",
		"go tool buf format -w",
		"make generate buf-lint",
		"grep -rn buf Makefile",
		"go test ./internal/rpc/",
	} {
		assert.Equal(t, "allow", decide(t, command(line)), line)
	}
}

func TestConnectV2Modules(t *testing.T) {
	for _, line := range []string{
		"go get connectrpc.com/connect",
		"go get connectrpc.com/connect@latest",
		"go get connectrpc.com/grpchealth connectrpc.com/grpcreflect",
		"go install connectrpc.com/connect/cmd/protoc-gen-connect-go@latest",
	} {
		assert.Equal(t, "deny", decide(t, command(line)), line)
	}
	for _, line := range []string{
		"go get connectrpc.com/connect/v2",
		"go get connectrpc.com/grpchealth/v2@latest connectrpc.com/grpcreflect/v2",
		"go get -tool connectrpc.com/connect/v2/cmd/protoc-gen-connect-go",
	} {
		assert.Equal(t, "allow", decide(t, command(line)), line)
	}
}
