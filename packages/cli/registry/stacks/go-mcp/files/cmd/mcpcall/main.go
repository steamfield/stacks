// Command mcpcall is a development client: it starts an MCP server over stdio,
// the way a host does, and lists its tools or calls one. `make smoke` and
// `make call` run it against bin/; it is not part of the shipped server.
//
//	go run ./cmd/mcpcall [-call TOOL [-args JSON]] SERVER [SERVER ARGS...]
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func main() {
	if err := run(os.Args[1:], os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, "mcpcall:", err)
		os.Exit(1)
	}
}

func run(args []string, stdout, stderr io.Writer) error {
	fs := flag.NewFlagSet("mcpcall", flag.ContinueOnError)
	fs.SetOutput(stderr)
	tool := fs.String("call", "", "call this tool instead of listing the tools")
	arguments := fs.String("args", "{}", "the tool's arguments as a JSON object")
	timeout := fs.Duration("timeout", 30*time.Second, "give up after this long")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() == 0 {
		return errors.New("usage: mcpcall [-call TOOL [-args JSON]] SERVER [SERVER ARGS...]")
	}
	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	server := exec.CommandContext(ctx, fs.Arg(0), fs.Args()[1:]...) //nolint:gosec // Running the named server is this tool's job.
	server.Stderr = stderr
	client := mcp.NewClient(&mcp.Implementation{Name: "mcpcall", Version: "dev"}, nil)
	session, err := client.Connect(ctx, &mcp.CommandTransport{Command: server}, nil)
	if err != nil {
		return fmt.Errorf("connect to %s: %w", fs.Arg(0), err)
	}
	defer func() { _ = session.Close() }()
	if *tool == "" {
		return list(ctx, session, stdout)
	}
	return call(ctx, session, *tool, *arguments, stdout)
}

func list(ctx context.Context, session *mcp.ClientSession, stdout io.Writer) error {
	count := 0
	for tool, err := range session.Tools(ctx, nil) {
		if err != nil {
			return fmt.Errorf("list tools: %w", err)
		}
		count++
		summary, _, _ := strings.Cut(tool.Description, "\n")
		fmt.Fprintf(stdout, "%s: %s\n", tool.Name, summary)
	}
	if count == 0 {
		return errors.New("the server lists no tools")
	}
	return nil
}

func call(ctx context.Context, session *mcp.ClientSession, tool, arguments string, stdout io.Writer) error {
	var args map[string]any
	if err := json.Unmarshal([]byte(arguments), &args); err != nil {
		return fmt.Errorf("-args must be a JSON object: %w", err)
	}
	res, err := session.CallTool(ctx, &mcp.CallToolParams{Name: tool, Arguments: args})
	if err != nil {
		return fmt.Errorf("call %s: %w", tool, err)
	}
	var texts []string
	for _, content := range res.Content {
		if text, ok := content.(*mcp.TextContent); ok {
			texts = append(texts, text.Text)
		}
	}
	if res.IsError {
		return fmt.Errorf("tool error: %s", strings.Join(texts, "\n"))
	}
	if res.StructuredContent != nil {
		out, err := json.MarshalIndent(res.StructuredContent, "", "  ")
		if err != nil {
			return err
		}
		_, err = fmt.Fprintf(stdout, "%s\n", out)
		return err
	}
	_, err = fmt.Fprintln(stdout, strings.Join(texts, "\n"))
	return err
}
