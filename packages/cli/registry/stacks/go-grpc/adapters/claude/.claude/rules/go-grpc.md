---
paths:
  - "proto/**"
  - "buf.yaml"
  - "buf.gen.yaml"
  - "internal/rpc/**"
---

# Protobuf and RPC rules

- The `.proto` files are the contract. Never renumber, retype or reuse a field number or name; delete a field by adding `reserved` for its number and name. Add fields and methods rather than changing them.
- After every `.proto` edit run `make generate`, then `make buf-lint generate-check`, and commit `proto/` and `gen/` together. Never edit `gen/`; the hook denies it.
- `make breaking` compares `proto/` with `main` (`BREAKING_AGAINST`). A breaking change needs a new package version (`notes.v2`) or the user's explicit approval.
- Each RPC gets its own `XRequest` and `XResponse` messages (buf STANDARD lint). Mark read-only methods `option idempotency_level = NO_SIDE_EFFECTS;`.
- Handlers in `internal/rpc` convert between messages and domain types and return domain errors from `internal/errors` unchanged. Only `toStatus` and `errorTable` pick status codes; never return `connect.NewError` with a cause's text.
- Interceptors go in `connect.NewServer`'s argument list in `rpc.New`: `logCalls`, then `recoverPanics`, then `mapErrors`. Keep request bodies out of logs.
- Imports are `connectrpc.com/connect/v2`, `grpchealth/v2` and `grpcreflect/v2`. A v1 import compiles but doesn't match the generated code.
- Run buf as `go tool buf` or through make; never `protoc` or a `buf` on PATH.

See the project's `AGENTS.md` for commands and the remaining conventions.
