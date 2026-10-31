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

const hook = "../../.claude/hooks/guard-tui.sh"

func decide(t *testing.T, input map[string]string) string {
	t.Helper()
	if _, err := exec.LookPath("jq"); err != nil {
		t.Skip("jq is not installed; the hook allows everything without it")
	}
	payload, err := json.Marshal(map[string]any{"tool_input": input})
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

func TestGoldenFramesAreGenerated(t *testing.T) {
	for _, path := range []string{
		"internal/ui/testdata/TestFrames/list.golden",
		"/work/project/internal/ui/testdata/TestFrames/detail.golden",
		"testdata/frame.golden",
	} {
		assert.Equal(t, "deny", decide(t, map[string]string{"file_path": path}), path)
	}
	for _, path := range []string{"internal/ui/view.go", "docs/frame.golden", "internal/ui/model_test.go"} {
		assert.Equal(t, "allow", decide(t, map[string]string{"file_path": path}), path)
	}
}

func TestNoFakeTerminal(t *testing.T) {
	for _, command := range []string{
		"script -q /dev/null ./bin/app",
		"make build && unbuffer ./bin/app",
		"tmux new-session -d ./bin/app",
		"echo $(screen ./bin/app)",
	} {
		assert.Equal(t, "deny", decide(t, map[string]string{"command": command}), command)
	}
	for _, command := range []string{
		"make test",
		"./bin/app --no-tui",
		"grep -rn screen internal/ui",
		"go test ./internal/ui -run TestFrames",
	} {
		assert.Equal(t, "allow", decide(t, map[string]string{"command": command}), command)
	}
}
