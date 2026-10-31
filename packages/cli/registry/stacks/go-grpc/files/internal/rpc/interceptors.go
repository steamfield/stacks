package rpc

import (
	"context"
	"log/slog"
	"runtime/debug"
	"strings"
	"time"

	"connectrpc.com/connect/v2"
)

// Interceptors surround the whole call, for every protocol and stream type.
// connect.NewServer runs them in argument order, the first outermost:
// logCalls, then recoverPanics, then mapErrors, then the handler.

// logCalls writes one record per RPC with its final status code. Health checks
// log at debug so probes don't flood the log. Request bodies are never logged.
func logCalls(logger *slog.Logger) connect.ServerInterceptor {
	return func(next connect.ServerFunc) connect.ServerFunc {
		return func(ctx context.Context, spec connect.Spec, stream connect.ServerStream) error {
			started := time.Now()
			err := next(ctx, spec, stream)
			code := "ok"
			if err != nil {
				code = connect.CodeOf(err).String()
			}
			protocol := ""
			if info, ok := connect.CallInfoForServerContext(ctx); ok {
				protocol = info.Protocol
			}
			level := slog.LevelInfo
			if strings.HasPrefix(spec.Procedure, "/grpc.health.v1.Health/") {
				level = slog.LevelDebug
			}
			logger.Log(ctx, level, "rpc", "procedure", spec.Procedure, "protocol", protocol,
				"code", code, "duration_ms", time.Since(started).Milliseconds())
			return err
		}
	}
}

// recoverPanics turns a handler panic into CodeInternal and logs the stack, so
// one bad request never takes the process down.
func recoverPanics(logger *slog.Logger) connect.ServerInterceptor {
	return func(next connect.ServerFunc) connect.ServerFunc {
		return func(ctx context.Context, spec connect.Spec, stream connect.ServerStream) (err error) {
			defer func() {
				if value := recover(); value != nil {
					logger.ErrorContext(ctx, "panic", "procedure", spec.Procedure, "panic", value,
						"stack", string(debug.Stack()))
					err = connect.NewError(connect.CodeInternal, internalMessage)
				}
			}()
			return next(ctx, spec, stream)
		}
	}
}

// mapErrors maps domain errors to RPC status codes through errorTable and logs
// server faults with their cause, which never reaches the caller.
func mapErrors(logger *slog.Logger) connect.ServerInterceptor {
	return func(next connect.ServerFunc) connect.ServerFunc {
		return func(ctx context.Context, spec connect.Spec, stream connect.ServerStream) error {
			err := next(ctx, spec, stream)
			if err == nil {
				return nil
			}
			public, fault := toStatus(err)
			if fault {
				logger.ErrorContext(ctx, "rpc failed", "procedure", spec.Procedure, "error", err)
			}
			return public
		}
	}
}
