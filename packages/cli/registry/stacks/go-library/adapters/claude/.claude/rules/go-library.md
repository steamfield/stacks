---
paths:
  - "*.go"
  - "internal/**"
  - "tests/**"
  - "api/**"
  - "go.mod"
  - "tools.mod"
---

# Go library rules

- The exported API is the product. Before adding, changing or removing an exported name, read `docs/public-api.md` and say whether the change is compatible. A breaking change needs the user's agreement, and from v1 on a new major version path (`/v2`); `make api-check` fails on one until then. Never run `make api-baseline` to make it pass.
- Every exported name has a doc comment starting with its name (`make lint` checks), and each entry point has an `Example` in `example_test.go` with an `// Output:` comment, which `go test` runs. An example without one only compiles.
- Errors: return a `*ParseError` (or a new exported error type) that wraps an exported sentinel, so callers use `errors.Is` for the kind and `errors.As` for details. Never compare error strings, and never panic on bad input.
- Library code never prints, logs through the global loggers, reads the environment, calls `os.Exit` or uses `init()` or mutable package variables (`make lint` rejects them). Settings arrive as `Option`s to `New`, validated there.
- Helpers that aren't API go under `internal/`. `tests/consumer` uses only what another module can import; `make consumer` runs it from outside this module.
- Runtime dependencies need the user's agreement; prefer the standard library. Dev tools go in `tools.mod` (`go get -modfile=tools.mod -tool`), never `go.mod`.
- Fuzz with `make fuzz`; plain `go test -fuzz` without `-fuzztime` never stops. A failing input lands in `testdata/fuzz/`: commit it, it is now a regression test.

See the project's `AGENTS.md` for commands and the remaining conventions.
