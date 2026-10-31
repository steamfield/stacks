# Architecture

`cmd/server/main.go` owns signals, startup failures and exit status. Its `run`
function loads configuration, creates the logger and store, binds a listener,
then runs an `http.Server` with bounded header, read, write and idle timeouts.
It logs the actual address before waiting for SIGINT or SIGTERM. Shutdown uses
a fresh context with the configured timeout and closes the server on failure.
Only `main` calls `os.Exit`; success is 0 and startup or shutdown failure is 1.

`internal/config` is the only package reading environment variables.
`internal/log` creates a JSON slog logger on the supplied writer, passed down
without changing the global logger. Runtime logs go to stdout.
`internal/errors` carries an error code, safe description and optional cause;
`Unwrap` preserves causes for `errors.Is` and `errors.As`.

`internal/notes` owns the resource, validation and the context-aware Store
interface. Its in-memory implementation protects the collection with a mutex.
It orders pages by creation time and then id. A database implementation can
replace the store without importing the HTTP package.

`internal/httpapi` owns routes and the HTTP boundary: strict JSON decoding,
the error table, JSON responses, request identification, access logs and panic
recovery. The middleware passes the same request to the mux and access logger
after installing its context, so the logger sees the matched route pattern.
Mux-generated 404 and 405 responses keep their status and Allow header while
their plain-text bodies become JSON.

Unit tests live beside the code. Handler tests use a real httptest listener.
Tagged integration tests build the binary once, start each server on a free
port and exercise HTTP and process signals. No external service is needed.
