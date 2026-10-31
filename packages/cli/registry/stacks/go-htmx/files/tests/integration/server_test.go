//go:build integration

package integration

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/PuerkitoBio/goquery"
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

type response struct {
	status int
	header http.Header
	body   string
	doc    *goquery.Document
}

func call(t *testing.T, server *runningServer, method, path string, form url.Values, headers map[string]string) response {
	t.Helper()
	client := &http.Client{
		Timeout:       2 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	req, err := http.NewRequestWithContext(t.Context(), method, "http://"+server.address+path, strings.NewReader(form.Encode()))
	require.NoError(t, err)
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	res, err := client.Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	require.NoError(t, err)
	doc, err := goquery.NewDocumentFromReader(bytes.NewReader(data))
	require.NoError(t, err)
	return response{status: res.StatusCode, header: res.Header, body: string(data), doc: doc}
}

func stop(t *testing.T, server *runningServer, signal os.Signal) {
	t.Helper()
	require.NoError(t, server.cmd.Process.Signal(signal))
	select {
	case <-server.exited:
	case <-time.After(5 * time.Second):
		t.Fatal("shutdown did not finish")
	}
	require.NoError(t, server.err)
	require.NoError(t, server.scanErr)
}

func TestPagesFormsAndSignalShutdown(t *testing.T) {
	for _, signal := range []os.Signal{syscall.SIGTERM, os.Interrupt} {
		t.Run(signal.String(), func(t *testing.T) {
			server := startServer(t, "127.0.0.1")
			page := call(t, server, "GET", "/", nil, map[string]string{"X-Request-Id": "integration"})
			require.Equal(t, 200, page.status)
			assert.Equal(t, "integration", page.header.Get("X-Request-Id"))
			assert.Equal(t, "text/html; charset=utf-8", page.header.Get("Content-Type"))
			script := page.doc.Find("script[src]").AttrOr("src", "")
			assert.Equal(t, "/static/vendor/htmx.min.js", script)

			asset := call(t, server, "GET", script, nil, nil)
			require.Equal(t, 200, asset.status)
			assert.Equal(t, "text/javascript; charset=utf-8", asset.header.Get("Content-Type"))
			assert.Contains(t, asset.body, "htmx", "the vendored file is htmx")

			fragment := call(t, server, "POST", "/notes", url.Values{"title": {"from htmx"}}, map[string]string{"HX-Request": "true"})
			require.Equal(t, 200, fragment.status, fragment.body)
			assert.Equal(t, "from htmx", fragment.doc.Find("li h2").Text())
			assert.Equal(t, "true", fragment.doc.Find("form").AttrOr("hx-swap-oob", ""))

			invalid := call(t, server, "POST", "/notes", url.Values{"title": {""}}, map[string]string{"HX-Request": "true"})
			assert.Equal(t, 422, invalid.status)
			assert.Equal(t, "#note-form", invalid.header.Get("HX-Retarget"))
			assert.Equal(t, "Enter a title.", invalid.doc.Find("#title-error").Text())

			redirect := call(t, server, "POST", "/notes", url.Values{"title": {"without htmx"}}, nil)
			assert.Equal(t, 303, redirect.status)
			assert.Equal(t, "/", redirect.header.Get("Location"))

			blocked := call(t, server, "POST", "/notes", url.Values{"title": {"forged"}}, map[string]string{"Sec-Fetch-Site": "cross-site"})
			assert.Equal(t, 403, blocked.status)

			titles := call(t, server, "GET", "/", nil, nil).doc.Find("#notes li h2").Map(func(_ int, s *goquery.Selection) string { return s.Text() })
			assert.Equal(t, []string{"without htmx", "from htmx"}, titles)

			_, port, err := net.SplitHostPort(server.address)
			require.NoError(t, err)
			probe := exec.Command(binary, "-healthcheck")
			probe.Env = []string{"PORT=" + port}
			out, err := probe.CombinedOutput()
			require.NoError(t, err, string(out))

			stop(t, server, signal)
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
			stop(t, server, syscall.SIGTERM)
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
