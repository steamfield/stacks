# Architecture

`proto/` holds the contract: `notes/v1/notes.proto` defines `NoteService`.
`buf.yaml` sets the module root and the lint and breaking-change rules;
`buf.gen.yaml` runs `protoc-gen-go` and `protoc-gen-connect-go` through
`go tool` into `gen/`, which is committed and never edited by hand.
`gen/notes/v1` holds the messages and `gen/notes/v1/notesv1connect` the
service interface, client constructor and registration function.

`cmd/server/main.go` owns signals, startup failures and exit status. Its `run`
function loads configuration, creates the logger, store and RPC server, binds a
listener and serves HTTP/1.1 and cleartext HTTP/2 (h2c) on one port. It logs
the actual address before waiting for SIGINT or SIGTERM. Shutdown first marks
health NOT_SERVING, then drains with the configured timeout and closes the
server on failure. Only `main` calls `os.Exit`; success is 0 and startup or
shutdown failure is 1. `-healthcheck` calls the running server's
`grpc.health.v1.Health/Check` over gRPC.

`internal/config` is the only package reading environment variables.
`internal/log` creates a JSON slog logger on the supplied writer, passed down
without changing the global logger. `internal/errors` carries a domain error
code, a message and an optional cause.

`internal/notes` owns the domain: validation and the context-aware `Store`
interface with an in-memory implementation. It imports nothing from protobuf
or Connect, so a database store replaces it without touching the RPC layer.

`internal/rpc` is the RPC boundary. `New` builds a `connect.Server` with three
interceptors (`logCalls`, `recoverPanics`, `mapErrors`, outermost first),
registers the notes handler, the gRPC health service and, when enabled, server
reflection, and mounts them on an `http.ServeMux` with `connecthttp.Mount`.
`/healthz` asks the health service in process through `connectinprocess`, so
plain HTTP probes and gRPC health clients see one status. `errors.go` holds the
only mapping from domain error codes to RPC status codes: client faults keep
their domain message, server faults send a fixed message and log the cause.

One handler serves three wire protocols: gRPC (HTTP/2), gRPC-Web and the
Connect protocol (HTTP/1.1 or HTTP/2, binary or JSON, and HTTP GET for methods
marked `NO_SIDE_EFFECTS`). Clients pick the protocol; the server needs no
configuration for it.

Unit tests live beside the code. `internal/rpc/server_test.go` serves the real
handler on a loopback port and calls it through the generated client over each
protocol. Tagged integration tests build the binary once, start it on a free
port and exercise gRPC, the Connect protocol, health and process signals. No
external service is needed.
