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

// run runs the hook on input with PATH as given and returns "allow" or the
// hook's decision and reason.
func run(t *testing.T, path string, input map[string]any) (string, string) {
	t.Helper()
	bash, err := exec.LookPath("bash")
	require.NoError(t, err)
	payload, err := json.Marshal(input)
	require.NoError(t, err)
	cmd := exec.Command(bash, hook)
	cmd.Env = append(os.Environ(), "CLAUDE_PROJECT_DIR=/work/project", "PATH="+path)
	cmd.Stdin = strings.NewReader(string(payload))
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
func decide(t *testing.T, input map[string]any) string {
	t.Helper()
	if _, err := exec.LookPath("jq"); err != nil {
		t.Fatal("jq is not installed; the hook needs it (brew install jq, or apt-get install jq)")
	}
	decision, _ := run(t, os.Getenv("PATH"), input)
	return decision
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
		"/work/project/internal/../gen/x.go",
		"./gen/notes/v1/../v1/doc.go",
	} {
		assert.Equal(t, "deny", decide(t, file(path)), path)
	}
	for _, path := range []string{
		"proto/notes/v1/notes.proto",
		"/work/project/internal/rpc/notes.go",
		"/work/project/internal/gen/helper.go",
		"/elsewhere/gen/notes.go",
		"/work/project/gen/../internal/rpc/server.go",
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
		"'buf' generate",
		"$'buf' generate",
		`b\uf generate`,
		"command buf generate",
		"env BUF_CACHE_DIR=/tmp buf generate",
		"exec buf generate",
		"nice -n 10 buf generate",
		"sudo buf generate",
		"xargs buf format -w",
		"sh -c 'buf generate'",
		`bash -c "buf lint"`,
		"/usr/local/bin/buf generate",
		"~/go/bin/buf generate",
		"npx @bufbuild/buf generate",
		"bunx @bufbuild/buf@latest lint",
		"go run github.com/bufbuild/buf/cmd/buf@latest generate",
		"go install github.com/bufbuild/buf/cmd/buf@latest",
	} {
		assert.Equal(t, "deny", decide(t, command(line)), line)
	}
	for _, line := range []string{
		"go tool buf lint",
		"go tool buf format -w",
		"env GOFLAGS=-mod=mod go tool buf generate",
		"make generate buf-lint",
		"grep -rn buf Makefile",
		"go test ./internal/rpc/",
		"go get -tool github.com/bufbuild/buf/cmd/buf",
		"cat buf.yaml buf.gen.yaml",
		"npx @bufbuild/protobuf --help",
		"./scripts/buf-check.sh",
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
		"go get -u connectrpc.com/connect/...",
		"go mod edit -require=connectrpc.com/connect@v1.18.1",
		"go mod edit -require connectrpc.com/grpcreflect@v1.3.0",
		"sh -c 'go get connectrpc.com/connect'",
		"go get connectrpc.com/connect/v2 connectrpc.com/grpchealth",
	} {
		assert.Equal(t, "deny", decide(t, command(line)), line)
	}
	for _, line := range []string{
		"go get connectrpc.com/connect/v2",
		"go get connectrpc.com/grpchealth/v2@latest connectrpc.com/grpcreflect/v2",
		"go get -tool connectrpc.com/connect/v2/cmd/protoc-gen-connect-go",
		"go get -u connectrpc.com/connect/v2/...",
		"go mod edit -require=connectrpc.com/connect/v2@v2.0.0",
		"go doc connectrpc.com/connect/v2",
		"grep -rn connectrpc.com/connect go.mod",
	} {
		assert.Equal(t, "allow", decide(t, command(line)), line)
	}
}

func TestBlocksEverythingWithoutJq(t *testing.T) {
	decision, reason := run(t, t.TempDir(), command("go test ./..."))
	assert.Equal(t, "deny", decision)
	assert.Contains(t, reason, "jq")
}
