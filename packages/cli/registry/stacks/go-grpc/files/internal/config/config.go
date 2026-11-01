package config

import (
	"fmt"
	"log/slog"
	"net"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Host            string
	Port            int
	LogLevel        slog.Level
	ShutdownTimeout time.Duration
	// DrainDelay is how long the server keeps answering NOT_SERVING after a
	// shutdown signal before it stops accepting connections, so health probes
	// see it and route new calls elsewhere.
	DrainDelay time.Duration
	// Reflection serves gRPC server reflection, so grpcurl and buf curl can list
	// and describe the services without the .proto files.
	Reflection bool
}

func value(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func Load() (Config, error) {
	cfg := Config{Host: value("HOST", "127.0.0.1")}
	var err error
	cfg.Port, err = strconv.Atoi(value("PORT", "8080"))
	if err != nil || cfg.Port < 0 || cfg.Port > 65535 {
		return Config{}, fmt.Errorf("PORT must be an integer between 0 and 65535")
	}
	if net.ParseIP(cfg.Host) == nil {
		return Config{}, fmt.Errorf("HOST must be an IP address")
	}
	switch value("LOG_LEVEL", "info") {
	case "debug":
		cfg.LogLevel = slog.LevelDebug
	case "info":
		cfg.LogLevel = slog.LevelInfo
	case "warn":
		cfg.LogLevel = slog.LevelWarn
	case "error":
		cfg.LogLevel = slog.LevelError
	default:
		return Config{}, fmt.Errorf("LOG_LEVEL must be debug, info, warn or error")
	}
	cfg.ShutdownTimeout, err = time.ParseDuration(value("SHUTDOWN_TIMEOUT", "10s"))
	if err != nil || cfg.ShutdownTimeout <= 0 {
		return Config{}, fmt.Errorf("SHUTDOWN_TIMEOUT must be a positive Go duration")
	}
	cfg.DrainDelay, err = time.ParseDuration(value("DRAIN_DELAY", "0s"))
	if err != nil || cfg.DrainDelay < 0 {
		return Config{}, fmt.Errorf("DRAIN_DELAY must be a Go duration of zero or more")
	}
	cfg.Reflection, err = strconv.ParseBool(value("REFLECTION", "true"))
	if err != nil {
		return Config{}, fmt.Errorf("REFLECTION must be true or false")
	}
	return cfg, nil
}
