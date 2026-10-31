package log

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLogger(t *testing.T) {
	for _, level := range []slog.Level{slog.LevelDebug, slog.LevelInfo, slog.LevelWarn, slog.LevelError} {
		t.Run(level.String(), func(t *testing.T) {
			var out bytes.Buffer
			logger := New(&out, level)
			logger.Log(t.Context(), level-1, "hidden")
			assert.Empty(t, out.String())
			logger.With("tool", "convert_units").Log(t.Context(), level, "visible")
			var record map[string]any
			require.NoError(t, json.Unmarshal(out.Bytes(), &record))
			assert.Equal(t, "visible", record["msg"])
			assert.Equal(t, level.String(), record["level"])
			assert.Equal(t, "convert_units", record["tool"])
			assert.NotEmpty(t, record["time"])
		})
	}
}

func TestFloor(t *testing.T) {
	var out bytes.Buffer
	logger := Floor(New(&out, slog.LevelDebug), slog.LevelWarn).With("component", "sdk").WithGroup("g")
	logger.Info("session connected")
	assert.Empty(t, out.String())
	logger.Warn("ping failed", "attempt", 1)
	assert.JSONEq(t, `{"level":"WARN","msg":"ping failed","component":"sdk","g":{"attempt":1}}`,
		dropTime(t, out.Bytes()))

	out.Reset()
	Floor(New(&out, slog.LevelError), slog.LevelWarn).Warn("below the handler's own level")
	assert.Empty(t, out.String())
}

func dropTime(t *testing.T, line []byte) string {
	t.Helper()
	var record map[string]any
	require.NoError(t, json.Unmarshal(line, &record))
	delete(record, "time")
	out, err := json.Marshal(record)
	require.NoError(t, err)
	return string(out)
}
