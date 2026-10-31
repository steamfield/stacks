package config

import (
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoad(t *testing.T) {
	for _, key := range []string{"HOST", "PORT", "LOG_LEVEL", "SHUTDOWN_TIMEOUT", "REFLECTION"} {
		t.Setenv(key, "")
	}
	cfg, err := Load()
	require.NoError(t, err)
	assert.Equal(t, Config{
		Host: "127.0.0.1", Port: 8080, LogLevel: slog.LevelInfo,
		ShutdownTimeout: 10 * time.Second, Reflection: true,
	}, cfg)
	for _, tt := range []struct{ key, value string }{
		{"PORT", "invalid"}, {"PORT", "-1"}, {"PORT", "65536"}, {"HOST", "invalid"},
		{"LOG_LEVEL", "verbose"}, {"SHUTDOWN_TIMEOUT", "bad"}, {"SHUTDOWN_TIMEOUT", "0s"},
		{"SHUTDOWN_TIMEOUT", "-1s"}, {"REFLECTION", "maybe"},
	} {
		t.Run(tt.key+"="+tt.value, func(t *testing.T) {
			t.Setenv(tt.key, tt.value)
			_, err := Load()
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.key)
		})
	}
	t.Setenv("HOST", "::1")
	t.Setenv("PORT", "0")
	t.Setenv("SHUTDOWN_TIMEOUT", "250ms")
	t.Setenv("REFLECTION", "false")
	for _, level := range []string{"debug", "info", "warn", "error"} {
		t.Run(level, func(t *testing.T) {
			t.Setenv("LOG_LEVEL", level)
			cfg, err := Load()
			require.NoError(t, err)
			assert.Equal(t, 0, cfg.Port)
			assert.Equal(t, "::1", cfg.Host)
			assert.Equal(t, 250*time.Millisecond, cfg.ShutdownTimeout)
			assert.False(t, cfg.Reflection)
			assert.Equal(t, strings.ToUpper(level), cfg.LogLevel.String())
		})
	}
}
