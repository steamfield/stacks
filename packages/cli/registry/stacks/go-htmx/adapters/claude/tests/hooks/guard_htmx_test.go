// Package hooks tests the Claude Code hooks under .claude/hooks.
package hooks

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	guard    = "../../.claude/hooks/guard-htmx.sh"
	generate = "../../.claude/hooks/templ-generate.sh"
)

// requireJQ fails rather than skips: without jq the guard blocks every tool
// call, so a machine without it can't run this project's agent either.
func requireJQ(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("jq"); err != nil {
		t.Fatal("jq is not installed; the hooks need it (brew install jq, or apt-get install jq)")
	}
}

func runHook(t *testing.T, hook, projectDir, path string, input map[string]any) []byte {
	t.Helper()
	bash, err := exec.LookPath("bash")
	require.NoError(t, err)
	payload, err := json.Marshal(input)
	require.NoError(t, err)
	cmd := exec.Command(bash, hook)
	cmd.Env = append(os.Environ(), "CLAUDE_PROJECT_DIR="+projectDir, "PATH="+path)
	cmd.Stdin = strings.NewReader(string(payload))
	out, err := cmd.Output()
	require.NoError(t, err)
	return out
}

// verdict returns "allow" or the guard's decision, and its reason.
func verdict(t *testing.T, path string, input map[string]any) (string, string) {
	t.Helper()
	out := runHook(t, guard, "/work/project", path, input)
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

func decide(t *testing.T, input map[string]any) string {
	t.Helper()
	requireJQ(t)
	decision, _ := verdict(t, os.Getenv("PATH"), input)
	return decision
}

func file(path string) map[string]any {
	return map[string]any{"tool_input": map[string]string{"file_path": path}}
}

func command(line string) map[string]any {
	return map[string]any{"tool_input": map[string]string{"command": line}}
}

func TestGeneratedAndVendoredFilesAreNotEdited(t *testing.T) {
	for _, path := range []string{
		"internal/views/notes_templ.go",
		"/work/project/internal/views/layout_templ.go",
		"/work/project/static/vendor/htmx.min.js",
		"static/vendor/other.js",
		"/work/project/internal/../static/vendor/htmx.min.js",
		"/work/project/static/./vendor/htmx.min.js",
	} {
		assert.Equal(t, "deny", decide(t, file(path)), path)
	}
	for _, path := range []string{
		"/work/project/internal/views/notes.templ",
		"/work/project/internal/views/models.go",
		"/work/project/static/app.css",
		"/work/project/internal/vendor/thing.go",
		"/work/project/static/vendor/../app.css",
	} {
		assert.Equal(t, "allow", decide(t, file(path)), path)
	}
}

func TestTemplRunsThroughGoTool(t *testing.T) {
	for _, line := range []string{
		"templ generate",
		"templ fmt . && make test",
		"make build; templ generate -watch",
		"echo $(templ version)",
		"'templ' generate",
		`"templ" generate`,
		"$'templ' generate",
		`t\empl generate`,
		"command templ generate",
		"env TEMPL_EXPERIMENT=rawgo templ generate",
		"exec templ generate",
		"nice -n 10 templ generate",
		"sudo templ generate",
		"sh -c 'templ generate'",
		`bash -c "templ fmt internal"`,
		"~/go/bin/templ generate",
		"/usr/local/bin/templ generate",
		"go install github.com/a-h/templ/cmd/templ@latest",
		"go run github.com/a-h/templ/cmd/templ@latest generate",
		"go run github.com/a-h/templ/cmd/templ generate",
		"GOFLAGS=-mod=mod go run github.com/a-h/templ/cmd/templ@v0 fmt .",
	} {
		assert.Equal(t, "deny", decide(t, command(line)), line)
	}
	for _, line := range []string{
		"go tool templ generate",
		"go tool templ fmt internal",
		"env CI=1 go tool templ generate -check",
		"make generate templ-fmt-check",
		"go get -tool github.com/a-h/templ/cmd/templ",
		"go get github.com/a-h/templ",
		"grep -rn templ Makefile",
		"echo templ generate",
		"ls internal/views/*.templ",
		"go doc github.com/a-h/templ",
		"cat ~/go/bin/templ.txt",
	} {
		assert.Equal(t, "allow", decide(t, command(line)), line)
	}
}

func TestBlocksEverythingWithoutJq(t *testing.T) {
	for _, input := range []map[string]any{command("go test ./..."), file("/work/project/internal/views/models.go")} {
		decision, reason := verdict(t, t.TempDir(), input)
		assert.Equal(t, "deny", decision, input)
		assert.Contains(t, reason, "jq")
	}
}

func TestTemplGenerateOnWrite(t *testing.T) {
	requireJQ(t)
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("go is not on PATH")
	}
	root, err := filepath.Abs("../..")
	require.NoError(t, err)
	dir := t.TempDir()
	write := func(name, content string) map[string]any {
		path := filepath.Join(dir, name)
		require.NoError(t, os.WriteFile(path, []byte(content), 0o600))
		return file(path)
	}
	path := os.Getenv("PATH")

	out := runHook(t, generate, root, path, write("ok.templ", "package probe\n\ntempl Probe(name string) {\n\t<p>{ name }</p>\n}\n"))
	assert.Empty(t, string(out))
	assert.FileExists(t, filepath.Join(dir, "ok_templ.go"))

	out = runHook(t, generate, root, path, write("broken.templ", "package probe\n\ntempl Broken( {\n"))
	var result struct {
		HookSpecificOutput struct{ HookEventName, AdditionalContext string }
	}
	require.NoError(t, json.Unmarshal(out, &result))
	assert.Equal(t, "PostToolUse", result.HookSpecificOutput.HookEventName)
	assert.Contains(t, result.HookSpecificOutput.AdditionalContext, "templ generate failed")

	assert.Empty(t, string(runHook(t, generate, root, path, write("notes.go", "package probe\n"))), "other files are ignored")
}
