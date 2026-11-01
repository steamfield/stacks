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

// run runs the hook on payload with projectDir as the project root and PATH
// as given, and returns "allow" or the hook's decision and reason.
func run(t *testing.T, projectDir, path string, payload map[string]any) (string, string) {
	t.Helper()
	bash, err := exec.LookPath("bash")
	if err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(bash, hook)
	cmd.Stdin = strings.NewReader(string(data))
	cmd.Env = append(os.Environ(), "CLAUDE_PROJECT_DIR="+projectDir, "PATH="+path)
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("hook failed on %v: %v", payload, err)
	}
	if len(out) == 0 {
		return "allow", ""
	}
	var result struct {
		HookSpecificOutput struct{ PermissionDecision, PermissionDecisionReason string }
	}
	if err := json.Unmarshal(out, &result); err != nil {
		t.Fatalf("hook printed %q: %v", out, err)
	}
	if result.HookSpecificOutput.PermissionDecisionReason == "" {
		t.Errorf("hook denied %v without a reason", payload)
	}
	return result.HookSpecificOutput.PermissionDecision, result.HookSpecificOutput.PermissionDecisionReason
}

// decide runs the hook with this PATH, which must have jq: without it the hook
// blocks everything, so a missing jq fails the test rather than skipping it.
func decide(t *testing.T, projectDir string, payload map[string]any) string {
	t.Helper()
	if _, err := exec.LookPath("jq"); err != nil {
		t.Fatal("jq is not installed; the hook needs it (brew install jq, or apt-get install jq)")
	}
	decision, _ := run(t, projectDir, os.Getenv("PATH"), payload)
	return decision
}

func command(line string) map[string]any {
	return map[string]any{"tool_input": map[string]string{"command": line}}
}

func file(path string) map[string]any {
	return map[string]any{"tool_input": map[string]string{"file_path": path, "content": "x"}}
}

// git runs git in dir with no user or system config.
func git(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false"}, args...)...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL="+os.DevNull, "GIT_CONFIG_NOSYSTEM=1")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
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
	for _, line := range []string{
		"go test -fuzz=FuzzParse .",
		"go test -run '^$' -fuzz FuzzParse ./...",
		"cd sub && go test -test.fuzz=FuzzParse",
		"go test -fuzz=FuzzParse -fuzztime=0s .",
		"go test -fuzz FuzzParse -fuzztime 0 .",
		"go get -tool golang.org/x/exp/cmd/apidiff",
		"go get -tool -modfile=other.mod golang.org/x/exp/cmd/apidiff",
		"env GOFLAGS=-mod=mod go get -tool golang.org/x/exp/cmd/apidiff",
	} {
		if got := decide(t, dir, command(line)); got != "deny" {
			t.Errorf("%q: got %s, want deny", line, got)
		}
	}
}

func TestDeniesRewritingTheBaseline(t *testing.T) {
	dir := projectWithBaseline(t)
	for _, line := range []string{
		"make api-baseline",
		"make fmt && make api-baseline",
		"make -C . api-baseline",
		"env make api-baseline",
		"command make api-baseline",
		"/usr/bin/make api-baseline",
		"gmake api-baseline",
		"sh -c 'make api-baseline'",
		`bash -c "make api-baseline"`,
		"go tool -modfile=tools.mod apidiff -m -w api/baseline.export example.com/lib",
		"rm api/baseline.export",
		"rm -f ./api/baseline.export && make api-baseline",
		"rm -rf api",
		"git rm api/baseline.export",
		"git rm -r api/",
		"mv api/baseline.export /tmp/old.export",
		"cp new.export api/baseline.export",
		"go doc -all > api/baseline.export",
		"sed -i '' 1d api/baseline.export",
	} {
		if got := decide(t, dir, command(line)); got != "deny" {
			t.Errorf("%q: got %s, want deny", line, got)
		}
	}
	for _, path := range []string{
		"api/baseline.export",
		filepath.Join(dir, "api", "baseline.export"),
		filepath.Join(dir, "internal", "..", "api", "baseline.export"),
	} {
		if got := decide(t, dir, file(path)); got != "deny" {
			t.Errorf("write %q: got %s, want deny", path, got)
		}
	}
}

func TestAllowsTheShippedWays(t *testing.T) {
	dir := projectWithBaseline(t)
	for _, line := range []string{
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
		"cat api/baseline.export",
		"git diff api/baseline.export",
		"git log --oneline -- api/baseline.export",
		"git add api/baseline.export",
		"cp api/baseline.export /tmp/old.export",
		"rm -rf bin/ coverage.out",
		"grep -n api-baseline Makefile",
		"echo make api-baseline is a release step",
	} {
		if got := decide(t, dir, command(line)); got != "allow" {
			t.Errorf("%q: got %s, want allow", line, got)
		}
	}
	for _, path := range []string{"api/notes.md", filepath.Join(dir, "duration.go"), filepath.Join(dir, "docs", "releasing.md")} {
		if got := decide(t, dir, file(path)); got != "allow" {
			t.Errorf("write %q: got %s, want allow", path, got)
		}
	}
}

func TestAllowsOnlyTheFirstBaseline(t *testing.T) {
	if got := decide(t, t.TempDir(), command("make api-baseline")); got != "allow" {
		t.Errorf("outside git, with no baseline yet: got %s, want allow", got)
	}

	fresh := t.TempDir()
	git(t, fresh, "init", "-q")
	if got := decide(t, fresh, command("make api-baseline")); got != "allow" {
		t.Errorf("a repository that never tracked a baseline: got %s, want allow", got)
	}

	staged := projectWithBaseline(t)
	git(t, staged, "init", "-q")
	git(t, staged, "add", "api/baseline.export")
	if err := os.Remove(filepath.Join(staged, "api", "baseline.export")); err != nil {
		t.Fatal(err)
	}
	if got := decide(t, staged, command("make api-baseline")); got != "deny" {
		t.Errorf("a staged baseline removed from the worktree: got %s, want deny", got)
	}

	committed := projectWithBaseline(t)
	git(t, committed, "init", "-q")
	git(t, committed, "add", "api/baseline.export")
	git(t, committed, "commit", "-q", "-m", "baseline")
	git(t, committed, "rm", "-q", "api/baseline.export")
	git(t, committed, "commit", "-q", "-m", "drop the baseline")
	if got := decide(t, committed, command("make api-baseline")); got != "deny" {
		t.Errorf("a baseline git once tracked: got %s, want deny", got)
	}
}

func TestBlocksEverythingWithoutJq(t *testing.T) {
	decision, reason := run(t, t.TempDir(), t.TempDir(), command("go test ./..."))
	if decision != "deny" || !strings.Contains(reason, "jq") {
		t.Errorf("without jq: got %s %q, want a deny naming jq", decision, reason)
	}
}
