//go:build integration

package integration

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

var binary string

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "mcp-integration-")
	if err != nil {
		panic(err)
	}
	binary = filepath.Join(dir, "server")
	build := exec.Command("go", "build", "-race", "-o", binary, ".")
	build.Dir = "../.."
	if out, err := build.CombinedOutput(); err != nil {
		_ = os.RemoveAll(dir)
		panic(fmt.Sprintf("build integration binary: %v\n%s", err, out))
	}
	code := m.Run()
	if err := os.RemoveAll(dir); err != nil {
		fmt.Fprintf(os.Stderr, "remove integration binary: %v\n", err)
		code = 1
	}
	os.Exit(code)
}
