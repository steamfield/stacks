package log

import (
	"io"
	"log/slog"
)

func New(stdout io.Writer, level slog.Level) *slog.Logger {
	return slog.New(slog.NewJSONHandler(stdout, &slog.HandlerOptions{Level: level}))
}
