# Public API

What this module exports, and the rules for changing it. Every module that imports this one compiles against the names below, so changing one is a release decision, not a refactor.

## Exports

Everything exported lives in the root package. `internal/` holds helpers no other module can import.

| Name | What it is |
| --- | --- |
| `Parse` | Read a duration with the default options |
| `Format` | Write a duration in the notation `Parse` reads |
| `New`, `Option`, `WithMax` | A `Parser` with options, validated by `New` |
| `Parser`, `Parser.Parse`, `Parser.Max` | The configured parser, safe for concurrent use |
| `Day`, `Week`, `MaxDuration` | Constants for the added units and the default maximum |
| `ParseError` | Every `Parse` error: `Input`, `Offset`, `Reason`, `Err`; `Unwrap` returns the kind |
| `ErrSyntax`, `ErrRange`, `ErrInvalidOption` | The kinds of failure, for `errors.Is` |

## Compatibility

Go modules follow semantic versioning, and the import path carries the major version: from v2 on, the module path ends in `/v2`, so v1 and v2 can be imported side by side. Before the first v1 release, a minor release may break callers, but treat a break as costly anyway.

Breaking, so the next release is a new major version (or, before v1, the next minor):

- removing or renaming an exported name, field or method, or changing a signature (adding a parameter included)
- adding a method to an exported interface
- changing what an error wraps, so an `errors.Is` check that held stops holding
- rejecting input that used to parse, or parsing it to a different value

Compatible: adding a function, type, method, option, sentinel error or struct field (callers who use keyed struct literals keep compiling).

Defaults that keep changes cheap: new settings are new `Option`s rather than parameters; errors carry their data in exported fields of an error type, so a caller never parses a message; exported structs are built by constructors.

## Checking a change

`make api-check` compares the exported API with `api/baseline.export`, the API recorded at the last release, using apidiff, and fails on any incompatible change. A compatible addition passes. The baseline moves only at a release (`docs/releasing.md`). `make doc` prints the documentation as pkg.go.dev will show it.
