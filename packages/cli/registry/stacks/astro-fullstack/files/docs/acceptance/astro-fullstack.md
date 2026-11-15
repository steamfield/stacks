# HTTP boundary acceptance

Implement `apps/api/tests/http-contract.test.ts` in Vitest's api project. Verify
runs it as its own step. Run the same cases against the actual Node
listener on an owned ephemeral port and the platform-free web fetch handler,
with fresh real service layers and captured structured logs on each transport.

| Case, on both transports | Required observations |
| --- | --- |
| Health success | 200, schema-decoded body, x-request-id, exactly one request record |
| Valid supplied request id | Response and log records retain the same id |
| Absent/unsafe request id | Fresh bounded safe id; no control characters or injected log fields |
| Unknown path and wrong method | 404 NotFound envelope, one request record each |
| Invalid/unknown query, params, payload | 400 BadInput envelope with a fixed safe message |
| Non-JSON payload | Framework's 415 rewritten as the shared envelope, preserving status |
| Every apiErrorTable row | Its declared status/tag/message/retryable through the shared schema |
| Response encoding failure | Generic 500 rather than request-side 400 |
| Defect with secret sentinel | Generic 500; one defect record with stack frames, no raw message, sentinel, body or credentials |
| Access logging | Exactly one request record even for misses/framework failures: method, path, status, id, UTC time and duration; duplicate framework logger disabled |

Use a real payload-taking proving endpoint to exercise decoding and media type.
Test ordinary HTTP headers so query strictness cannot reject them. Invalid live
startup config must fail acquisition before listening. No own-service mocks.

With STATIC_DIR, also request a built page, directory index and missing page;
assert content/status, request ids and one request record. API misses under /v1
must remain API envelopes rather than silently becoming the site's 404. Keep
build-time content independent of a running API. The browser proving slice uses
the contract's real client through the same-origin proxy.

Close servers and runtimes in finalizers. Test third-party failures against owned
stubs only, without credentials. Extend the matrix for endpoint-specific limits,
Location/201 and body-less 204 when those endpoints exist. Aggregate coverage
does not substitute for this table or certify the complete application contract.
