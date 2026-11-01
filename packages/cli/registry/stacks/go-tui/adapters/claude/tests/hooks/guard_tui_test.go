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

const hook = "../../.claude/hooks/guard-tui.sh"

// run runs the hook on input with PATH as given and returns "allow" or the
// hook's decision and reason.
func run(t *testing.T, path string, input map[string]string) (string, string) {
	t.Helper()
	bash, err := exec.LookPath("bash")
	require.NoError(t, err)
	payload, err := json.Marshal(map[string]any{"tool_input": input})
	require.NoError(t, err)
	cmd := exec.Command(bash, hook)
	cmd.Stdin = strings.NewReader(string(payload))
	cmd.Env = append(os.Environ(), "PATH="+path)
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
func decide(t *testing.T, input map[string]string) string {
	t.Helper()
	if _, err := exec.LookPath("jq"); err != nil {
		t.Fatal("jq is not installed; the hook needs it (brew install jq, or apt-get install jq)")
	}
	decision, _ := run(t, os.Getenv("PATH"), input)
	return decision
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
		"'script' -q /dev/null ./bin/app",
		`"tmux" new -d ./bin/app`,
		"$'unbuffer' ./bin/app",
		`scr\ipt -q /dev/null ./bin/app`,
		"command script -q /dev/null ./bin/app",
		"env TERM=xterm script -q /dev/null ./bin/app",
		"exec tmux new -d ./bin/app",
		"nice -n 10 unbuffer ./bin/app",
		"sudo screen ./bin/app",
		"sh -c 'script -q /dev/null ./bin/app'",
		`bash -c "tmux new -d ./bin/app"`,
		"/usr/bin/script -q /dev/null ./bin/app",
		"expect -c 'spawn ./bin/app; interact'",
		`python3 -c 'import pty; pty.spawn(["./bin/app"])'`,
		`python -c "import os, pty; pid, fd = pty.fork()"`,
		"python3 -c 'import os; os.openpty()'",
	} {
		assert.Equal(t, "deny", decide(t, map[string]string{"command": command}), command)
	}
	for _, command := range []string{
		"make test",
		"./bin/app --no-tui",
		"./bin/app --json | head",
		"grep -rn screen internal/ui",
		"grep -rn tmux docs",
		"./scripts/x.sh",
		"go test ./...",
		"go test ./internal/ui -run TestFrames",
		"python3 -c 'print(1)'",
		"cat docs/script.md",
	} {
		assert.Equal(t, "allow", decide(t, map[string]string{"command": command}), command)
	}
}

func TestBlocksEverythingWithoutJq(t *testing.T) {
	decision, reason := run(t, t.TempDir(), map[string]string{"command": "go test ./..."})
	assert.Equal(t, "deny", decision)
	assert.Contains(t, reason, "jq")
}
