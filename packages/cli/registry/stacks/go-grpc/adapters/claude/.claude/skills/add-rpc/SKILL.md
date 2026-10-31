---
name: add-rpc
description: Add an RPC method to the protobuf service in proto/, regenerate gen/, implement it in internal/rpc and test it over the wire. Use when the user asks for a new endpoint, method, call or operation on the gRPC service.
---

# Add an RPC

`GetNote` is the model to copy: a method and its two messages in `notes.proto`, a domain method in `internal/notes`, a handler method on `noteService` and cases in `server_test.go`.

1. In `proto/notes/v1/notes.proto` (or the service's own file), add the `rpc` with new `<Method>Request` and `<Method>Response` messages. Use new field numbers only. Add `option idempotency_level = NO_SIDE_EFFECTS;` when it only reads.
2. Run `make generate`, then `make buf-lint`. Read the new method's signature on `NoteServiceHandler` in `gen/notes/v1/notesv1connect/`; don't edit `gen/`.
3. Put the logic in the domain package, behind its `Store` interface when it touches data. Validation failures return `apperrors.New(apperrors.BadInput, "<message for the caller>")`; a missing record returns `NotFound`.
4. Add the method on `noteService` in `internal/rpc/notes.go`: convert the request, call the domain, convert the result, return domain errors unchanged.
5. In `internal/rpc/server_test.go`, extend `TestNotesOverEveryProtocol` with the success case and each error code. A new domain error code also needs a row in `errorTable` and a case in `TestErrorTable`.
6. Run `make generate-check fmt-check lint test test-integration`, and `make breaking` once the repository has a `main` branch. Commit `proto/`, `gen/` and the code together.
