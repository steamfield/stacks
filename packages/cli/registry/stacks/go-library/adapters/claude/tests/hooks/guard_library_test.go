// Package hooks tests the Claude Code hooks under .claude/hooks.
package hooks

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const hook = "../../.claude/hooks/guard-library.sh"

// decide runs the hook on command with projectDir as the project root and
// returns "allow" or the hook's decision.
func decide(t *testing.T, projectDir, command string) string {
	t.Helper()
	if _, err := exec.LookPath("jq"); err != nil {
		t.Skip("jq is not installed; the hook allows everything without it")
	}
	payload, err := json.Marshal(map[string]any{"tool_input": map[string]string{"command": command}})
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("bash", hook)
	cmd.Stdin = strings.NewReader(string(payload))
	cmd.Env = append(os.Environ(), "CLAUDE_PROJECT_DIR="+projectDir)
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("hook failed on %q: %v", command, err)
	}
	if len(out) == 0 {
		return "allow"
	}
	var result struct {
		HookSpecificOutput struct{ PermissionDecision, PermissionDecisionReason string }
	}
	if err := json.Unmarshal(out, &result); err != nil {
		t.Fatalf("hook printed %q: %v", out, err)
	}
	if result.HookSpecificOutput.PermissionDecisionReason == "" {
		t.Errorf("hook denied %q without a reason", command)
	}
	return result.HookSpecificOutput.PermissionDecision
}

// projectWithBaseline returns a project directory holding api/baseline.export.
func projectWithBaseline(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "api"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "api", "baseline.export"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestDeniesMisleadingCommands(t *testing.T) {
	dir := projectWithBaseline(t)
	for _, command := range []string{
		"go test -fuzz=FuzzParse .",
		"go test -run '^$' -fuzz FuzzParse ./...",
		"cd sub && go test -test.fuzz=FuzzParse",
		"go get -tool golang.org/x/exp/cmd/apidiff",
		"go get -tool -modfile=other.mod golang.org/x/exp/cmd/apidiff",
		"make api-baseline",
		"make fmt && make api-baseline",
		"go tool -modfile=tools.mod apidiff -m -w api/baseline.export example.com/lib",
	} {
		if got := decide(t, dir, command); got != "deny" {
			t.Errorf("%q: got %s, want deny", command, got)
		}
	}
}

func TestAllowsTheShippedWays(t *testing.T) {
	dir := projectWithBaseline(t)
	for _, command := range []string{
		"make fuzz",
		"make fuzz FUZZTIME=30s",
		"go test -run '^$' -fuzz=FuzzParse -fuzztime=30s .",
		"go test -fuzz FuzzParse -fuzztime 1000x .",
		"go test -race ./...",
		"go test -run FuzzParse .",
		"go get -modfile=tools.mod -tool golang.org/x/exp/cmd/apidiff",
		"go get golang.org/x/text",
		"make api-check",
		"go tool -modfile=tools.mod apidiff -m -incompatible api/baseline.export example.com/lib",
	} {
		if got := decide(t, dir, command); got != "allow" {
			t.Errorf("%q: got %s, want allow", command, got)
		}
	}
}

func TestAllowsTheFirstBaseline(t *testing.T) {
	if got := decide(t, t.TempDir(), "make api-baseline"); got != "allow" {
		t.Errorf("make api-baseline with no baseline yet: got %s, want allow", got)
	}
}
