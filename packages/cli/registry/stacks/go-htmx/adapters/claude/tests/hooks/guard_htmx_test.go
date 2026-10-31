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

func requireJQ(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("jq"); err != nil {
		t.Skip("jq is not installed; the hooks allow everything without it")
	}
}

func runHook(t *testing.T, hook, projectDir string, input map[string]any) []byte {
	t.Helper()
	payload, err := json.Marshal(input)
	require.NoError(t, err)
	cmd := exec.Command("bash", hook)
	cmd.Env = append(os.Environ(), "CLAUDE_PROJECT_DIR="+projectDir)
	cmd.Stdin = strings.NewReader(string(payload))
	out, err := cmd.Output()
	require.NoError(t, err)
	return out
}

func decide(t *testing.T, input map[string]any) string {
	t.Helper()
	requireJQ(t)
	out := runHook(t, guard, "/work/project", input)
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

func TestGeneratedAndVendoredFilesAreNotEdited(t *testing.T) {
	for _, path := range []string{
		"internal/views/notes_templ.go",
		"/work/project/internal/views/layout_templ.go",
		"/work/project/static/vendor/htmx.min.js",
		"static/vendor/other.js",
	} {
		assert.Equal(t, "deny", decide(t, file(path)), path)
	}
	for _, path := range []string{
		"/work/project/internal/views/notes.templ",
		"/work/project/internal/views/models.go",
		"/work/project/static/app.css",
		"/work/project/internal/vendor/thing.go",
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
		"go install github.com/a-h/templ/cmd/templ@latest",
	} {
		assert.Equal(t, "deny", decide(t, command(line)), line)
	}
	for _, line := range []string{
		"go tool templ generate",
		"go tool templ fmt internal",
		"make generate templ-fmt-check",
		"go get -tool github.com/a-h/templ/cmd/templ",
		"grep -rn templ Makefile",
	} {
		assert.Equal(t, "allow", decide(t, command(line)), line)
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

	out := runHook(t, generate, root, write("ok.templ", "package probe\n\ntempl Probe(name string) {\n\t<p>{ name }</p>\n}\n"))
	assert.Empty(t, string(out))
	assert.FileExists(t, filepath.Join(dir, "ok_templ.go"))

	out = runHook(t, generate, root, write("broken.templ", "package probe\n\ntempl Broken( {\n"))
	var result struct {
		HookSpecificOutput struct{ HookEventName, AdditionalContext string }
	}
	require.NoError(t, json.Unmarshal(out, &result))
	assert.Equal(t, "PostToolUse", result.HookSpecificOutput.HookEventName)
	assert.Contains(t, result.HookSpecificOutput.AdditionalContext, "templ generate failed")

	assert.Empty(t, string(runHook(t, generate, root, write("notes.go", "package probe\n"))), "other files are ignored")
}
