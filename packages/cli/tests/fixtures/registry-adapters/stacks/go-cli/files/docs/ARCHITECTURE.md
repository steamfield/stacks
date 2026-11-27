# Architecture

The root `main.go` holds build metadata and calls `internal/cli.Execute`.
The command tree is built fresh for each invocation. `Execute` owns signal
cancellation, exit status and the single error report. Commands use Cobra's
output streams, so callers and tests can redirect them.
The output writer retains failures from Cobra's help callback so `Execute`
can report them once and return a failing status.

`internal/config` loads a typed configuration from a fresh Viper instance.
`config show` receives that configuration and a logger, and sends its result
through `internal/output`. Domain packages do not import `internal/cli`.

`internal/errors` owns codes, causes, suggestions and exit status mapping:
success is 0, runtime failures are 1 and invalid input is 2. `internal/output`
renders human text or a single JSON document. JSON errors go to stderr under
an `error` key with `code`, `message` and `suggestion` fields.

`internal/log` creates the invocation's stderr logger without changing the
global logger. Debug diagnostics are opt-in. JSON mode uses JSON log records.

Unit tests live beside each package. Tagged integration tests build the binary
once and exercise it as a separate process.
