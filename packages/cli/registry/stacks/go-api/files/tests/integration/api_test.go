//go:build integration

package integration

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type runningServer struct {
	cmd     *exec.Cmd
	address string
	exited  chan struct{}
	err     error
	logs    []map[string]any
	scanErr error
}

type response struct {
	StatusCode int
	Header     http.Header
}

func startServer(t *testing.T, host string) *runningServer {
	t.Helper()
	server := &runningServer{cmd: exec.Command(binary), exited: make(chan struct{})}
	server.cmd.Env = []string{"HOST=" + host, "PORT=0", "LOG_LEVEL=debug", "SHUTDOWN_TIMEOUT=2s"}
	server.cmd.Dir = t.TempDir()
	stdout, err := server.cmd.StdoutPipe()
	require.NoError(t, err)
	var stderr bytes.Buffer
	server.cmd.Stderr = &stderr
	require.NoError(t, server.cmd.Start())
	ready := make(chan string, 1)
	// Keep reading through process exit. Wait only after draining StdoutPipe.
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			var record map[string]any
			if err := json.Unmarshal(scanner.Bytes(), &record); err != nil {
				server.scanErr = err
				continue
			}
			server.logs = append(server.logs, record)
			if record["msg"] == "listening" {
				if address, ok := record["address"].(string); ok {
					ready <- address
				}
			}
		}
		if err := scanner.Err(); err != nil {
			server.scanErr = err
		}
		server.err = server.cmd.Wait()
		close(server.exited)
	}()
	t.Cleanup(func() {
		select {
		case <-server.exited:
		default:
			_ = server.cmd.Process.Kill()
			select {
			case <-server.exited:
			case <-time.After(5 * time.Second):
				t.Error("server did not exit after kill")
			}
		}
	})
	select {
	case server.address = <-ready:
	case <-server.exited:
		t.Fatalf("server exited before listening: %v, %s", server.err, stderr.String())
	case <-time.After(10 * time.Second):
		t.Fatal("server did not report listening")
	}
	return server
}

func TestHTTPAndSignalShutdown(t *testing.T) {
	for _, signal := range []os.Signal{syscall.SIGTERM, os.Interrupt} {
		t.Run(signal.String(), func(t *testing.T) {
			server := startServer(t, "127.0.0.1")
			client := &http.Client{Timeout: 2 * time.Second}
			call := func(method, path, body string) (response, []byte) {
				req, err := http.NewRequestWithContext(t.Context(), method, "http://"+server.address+path, strings.NewReader(body))
				require.NoError(t, err)
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("X-Request-Id", "integration")
				res, err := client.Do(req)
				require.NoError(t, err)
				defer res.Body.Close()
				data, err := io.ReadAll(res.Body)
				require.NoError(t, err)
				assert.Equal(t, "integration", res.Header.Get("X-Request-Id"))
				assert.Equal(t, "application/json", res.Header.Get("Content-Type"))
				assert.Equal(t, "no-store", res.Header.Get("Cache-Control"))
				return response{StatusCode: res.StatusCode, Header: res.Header}, data
			}
			res, data := call("GET", "/healthz", "")
			assert.Equal(t, 200, res.StatusCode)
			assert.JSONEq(t, `{"status":"ok"}`, string(data))
			res, created := call("POST", "/v1/notes", `{"title":"integration","body":"from the binary"}`)
			require.Equal(t, 201, res.StatusCode, string(created))
			require.NotEmpty(t, res.Header.Get("Location"))
			res, data = call("GET", res.Header.Get("Location"), "")
			assert.Equal(t, 200, res.StatusCode)
			assert.JSONEq(t, string(created), string(data))
			res, data = call("POST", "/v1/notes", `{}`)
			assert.Equal(t, 400, res.StatusCode)
			assert.JSONEq(t, `{"error":{"tag":"BadInput","message":"Invalid request.","retryable":false}}`, string(data))
			_, port, err := net.SplitHostPort(server.address)
			require.NoError(t, err)
			probe := exec.Command(binary, "-healthcheck")
			probe.Env = []string{"PORT=" + port}
			out, err := probe.CombinedOutput()
			require.NoError(t, err, string(out))
			require.NoError(t, server.cmd.Process.Signal(signal))
			select {
			case <-server.exited:
			case <-time.After(5 * time.Second):
				t.Fatal("shutdown did not finish")
			}
			require.NoError(t, server.err)
			require.NoError(t, server.scanErr)
			var messages []string
			for _, record := range server.logs {
				messages = append(messages, record["msg"].(string))
			}
			assert.Contains(t, messages, "shutting down")
			assert.Equal(t, "stopped", messages[len(messages)-1])
		})
	}
}

func TestHealthcheckBindAddresses(t *testing.T) {
	for _, host := range []string{"::1", "0.0.0.0", "::"} {
		t.Run(host, func(t *testing.T) {
			server := startServer(t, host)
			_, port, err := net.SplitHostPort(server.address)
			require.NoError(t, err)
			probe := exec.Command(binary, "-healthcheck")
			probe.Env = []string{"HOST=" + host, "PORT=" + port}
			out, err := probe.CombinedOutput()
			require.NoError(t, err, string(out))
			require.NoError(t, server.cmd.Process.Signal(syscall.SIGTERM))
			select {
			case <-server.exited:
			case <-time.After(5 * time.Second):
				t.Fatal("shutdown did not finish")
			}
			require.NoError(t, server.err)
		})
	}
}

func TestStartupFailures(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer listener.Close()
	_, port, err := net.SplitHostPort(listener.Addr().String())
	require.NoError(t, err)
	for _, tt := range []struct {
		name      string
		args, env []string
		message   string
	}{
		{"config", nil, []string{"PORT=invalid"}, "PORT"},
		{"occupied port", nil, []string{"HOST=127.0.0.1", "PORT=" + port}, "listen"},
		{"arguments", []string{"unknown"}, nil, "unknown arguments"},
		{"failed healthcheck", []string{"-healthcheck"}, []string{"PORT=0"}, "healthcheck"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			cmd := exec.Command(binary, tt.args...)
			cmd.Env = append([]string{}, tt.env...)
			out, err := cmd.CombinedOutput()
			var exit *exec.ExitError
			require.ErrorAs(t, err, &exit)
			assert.Equal(t, 1, exit.ExitCode())
			var record map[string]any
			require.NoError(t, json.Unmarshal(out, &record))
			assert.Contains(t, record["error"], tt.message)
		})
	}
}
