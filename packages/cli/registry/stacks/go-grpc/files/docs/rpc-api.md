# RPC API

The contract is `proto/notes/v1/notes.proto`; this page covers what the
`.proto` file can't say.

## Calling the service

Every method is served at `/<package>.<Service>/<Method>` on one port, over
three protocols:

| Protocol | Transport | Typical client |
|---|---|---|
| gRPC | HTTP/2 (h2c locally) | grpc-go, grpcurl, any gRPC stack |
| gRPC-Web | HTTP/1.1 or HTTP/2 | browsers through a gRPC-Web client |
| Connect | HTTP/1.1 or HTTP/2, binary or JSON | connect clients, curl |

```sh
curl -s -H 'Content-Type: application/json' \
  -d '{"title":"first","body":"hello"}' \
  http://127.0.0.1:8080/notes.v1.NoteService/CreateNote

curl -s --get --data-urlencode 'encoding=json' \
  --data-urlencode 'message={"id":"<id>"}' \
  http://127.0.0.1:8080/notes.v1.NoteService/GetNote

go tool buf curl --protocol grpc --http2-prior-knowledge \
  http://127.0.0.1:8080/grpc.health.v1.Health/Check
```

`GetNote` is marked `NO_SIDE_EFFECTS`, so Connect clients may use HTTP GET
for it and caches can store the response. Requests above 1 MiB fail with
`resource_exhausted`.

## Errors

Every failure is a status code and a message, in gRPC trailers or a Connect
JSON error body (`{"code":"not_found","message":"note not found"}`).

| Domain code | Status | Message |
|---|---|---|
| BadInput | `invalid_argument` | The domain's own, written for the caller |
| NotFound | `not_found` | The domain's own |
| Unavailable | `unavailable` | `service unavailable` |
| Internal, anything else | `internal` | `internal error` |

Canceled calls and expired deadlines return `canceled` and
`deadline_exceeded`. A panic returns `internal`. Server faults log the cause;
it never reaches the caller.

## Health and reflection

`grpc.health.v1.Health` answers `Check` and `Watch` for the empty service name
(the process) and `notes.v1.NoteService`; an unknown name is `not_found`.
Both turn NOT_SERVING when shutdown starts. `GET /healthz` mirrors the process
status for HTTP-only probes. Server reflection (`grpc.reflection.v1` and
`v1alpha`) is on unless `REFLECTION=false`; it needs HTTP/2.

## Changing the contract

Field numbers and names are permanent once a client exists. Add fields and
methods; remove a field by marking its number and name `reserved`. `make
breaking` runs `buf breaking` against `main` with the FILE rules in
`buf.yaml`; CI runs it against the pull request's base.
