package log

import (
	"context"
	"io"
	"log/slog"
)

// New returns a JSON logger on w, which is stderr in the server: on the stdio
// transport stdout carries only protocol messages. Pass the logger down;
// never call slog.SetDefault.
func New(w io.Writer, level slog.Level) *slog.Logger {
	return slog.New(slog.NewJSONHandler(w, &slog.HandlerOptions{Level: level}))
}

// Floor returns a logger on the same handler that drops records below lowest.
// The MCP SDK logs every session start and stop at info; the server hands it
// Floor(logger, slog.LevelWarn) so only its warnings and errors appear.
func Floor(logger *slog.Logger, lowest slog.Level) *slog.Logger {
	return slog.New(floor{Handler: logger.Handler(), min: lowest})
}

type floor struct {
	slog.Handler
	min slog.Level
}

func (f floor) Enabled(ctx context.Context, level slog.Level) bool {
	return level >= f.min && f.Handler.Enabled(ctx, level)
}

func (f floor) WithAttrs(attrs []slog.Attr) slog.Handler {
	return floor{Handler: f.Handler.WithAttrs(attrs), min: f.min}
}

func (f floor) WithGroup(name string) slog.Handler {
	return floor{Handler: f.Handler.WithGroup(name), min: f.min}
}
