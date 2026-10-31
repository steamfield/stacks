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
			logger.With("request_id", "test").Log(t.Context(), level, "visible")
			var record map[string]any
			require.NoError(t, json.Unmarshal(out.Bytes(), &record))
			assert.Equal(t, "visible", record["msg"])
			assert.Equal(t, level.String(), record["level"])
			assert.Equal(t, "test", record["request_id"])
			assert.NotEmpty(t, record["time"])
		})
	}
}
