# HTTP boundary acceptance

Implement `tests/http-contract.test.ts`; verify runs this application contract
as its own step. Use the real app and services,
fresh state, and captured structured logs. Test the same table through a Node
server on an owned ephemeral port and the platform-free web fetch handler. The
web build must use platform-free server services, with no Node-only dependency
hidden behind the request handler. No own-service mocks or hand-built envelopes.

| Case, on both transports | Status/body/header/log assertions |
| --- | --- |
| Health success | 200, schema-decoded body, x-request-id, exactly one request record |
| Supplied valid request id | Returned unchanged; same id on request and defect records |
| Missing or unsafe request id | Fresh bounded safe id, no injected log fields or control characters |
| Unknown path and wrong method | 404 NotFound envelope; exactly one request record each |
| Invalid query, unknown query key, params or payload | 400 BadInput envelope, fixed safe message |
| Non-JSON payload | 415 envelope from the framework response, preserving status |
| Every apiErrorTable row | Its declared status, tag, fixed message and retryable; decoded by the shared schema |
| Response encoding failure | Generic 500, never misclassified as a request's 400 |
| Thrown defect with secret sentinel | Generic 500; one defect record with stack frames, no sentinel/message/body/header leak |
| Request logging | One request record even for misses/framework failures; time, status, method, path, duration and id; framework duplicate logger disabled |

Test invalid startup config separately: acquiring the live app fails before
listening. Define a small payload-taking proving endpoint if the base only has
health, so decode and media-type cases exercise real framework behavior. Test
ordinary headers too: rejecting unknown query keys must not reject HTTP headers.
Close every server/runtime in finalizers, and use no external network or secrets.

Extend the table for each endpoint's limits, errors, create Location/201 and
body-less 204 behavior when those endpoints exist. Check response values and
counts, not merely successful requests or high aggregate coverage. Read the shared
Effect API and testing guidance before implementing this suite.
