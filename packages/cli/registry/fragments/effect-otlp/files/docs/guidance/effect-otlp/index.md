# OpenTelemetry for Effect servers

The server exports traces, logs and metrics over OTLP/HTTP through one observability layer. Business code keeps using Effect's spans, log functions and metrics and never imports an OTLP module. With no endpoint configured the layer exports nothing, which is the normal state for development, tests and CI.

## The API

Effect ships its OTLP exporters in the `effect` package, under `effect/observability`: `Otlp` (all three signals in one layer), `OtlpTracer`, `OtlpLogger`, `OtlpMetrics`, `OtlpResource` and `OtlpSerialization`. These modules are marked unstable, so check each name against the installed declarations (`node_modules/effect/dist/observability/*.d.ts`) and the example at `node_modules/effect/ai-docs/src/08_observability/20_otlp-tracing.ts` before using it.

- Build the layer with `Otlp.layerProtobuf({ baseUrl, resource, headers, maxBatchSize, shutdownTimeout })` (or `Otlp.layerJson`, per the wire-format decision), from values `config.ts` parsed. It needs an `HttpClient`: Effect's `FetchHttpClient.layer` or the one the stack's platform entry already provides.
- Always pass `resource.serviceName`. `OtlpResource.fromConfig`, which these layers call, otherwise reads `OTEL_SERVICE_NAME` from the ambient `ConfigProvider` and dies when it is unset. It also merges `OTEL_RESOURCE_ATTRIBUTES` from that provider into the resource, so tests provide a fresh `ConfigProvider`.
- `Otlp.layerFromConfig` also exists and reads the standard variables itself, but it exports a signal only when `OTEL_TRACES_EXPORTER`, `OTEL_LOGS_EXPORTER` or `OTEL_METRICS_EXPORTER` explicitly lists `otlp`. The specification defaults those to `otlp`; Effect defaults them to empty. With only the endpoint set, it silently exports nothing. Don't use it unless you also document and test those variables.

Don't add `@effect/opentelemetry` or the OpenTelemetry JS SDK packages: the native exporters need neither, and they bring a second tracer and context model.

## Where the layer lives

| Stack | Layer | Provided by | Test file | `test:telemetry` runs |
| --- | --- | --- | --- | --- |
| typescript-api | `src/observability.ts` | `src/platform/node.ts` | `tests/telemetry.test.ts` | Vitest on that file |
| astro-fullstack | `apps/api/src/observability.ts` | `apps/api/src/platform/node.ts` | `apps/api/tests/telemetry.test.ts` | Vitest's `api` project on that file |
| react-router | `app/.server/observability.ts` | `AppLayer` in `app/.server/runtime.ts` | `tests/telemetry.test.ts` | Vitest on that file |

On typescript-api and astro-fullstack the layer is platform-free (it needs only an HTTP client, which the platform entry provides), so the web-handler entry can provide it too. The Node entry's existing graceful shutdown closes the layer's scope, which runs the flush.

On astro-fullstack only the API process is instrumented. The site and the contract never import the layer, and no OTEL variable is named with `PUBLIC_`, because Astro bakes those into the browser bundle.

On react-router only server code is instrumented. The layer sits under `app/.server/`, which the server-import hook and the production build keep out of client code. In `runtime.ts`, build it on top of the stack's logger layer, never beside it in `Layer.mergeAll`: the stack installs its logger with `Logger.layer([...])`, which replaces the whole logger set, and the OTLP logger only merges into the set that exists when it is built. Side by side, whichever builds last wins and OTLP log export silently disappears. Write it as `observability.pipe(Layer.provideMerge(logging))` (check the name against the installed `Layer` declarations), and have a test assert both that the receiver gets a POST to `/v1/logs` and that the stack's logger still records the same line.

The framework's production server doesn't dispose the `ManagedRuntime`, so register SIGTERM and SIGINT handlers in `runtime.ts` that dispose it, bounded by the shutdown timeout. Register them only in the production server: not under Vitest (`process.env.VITEST`) and not in Vite's dev SSR (`import.meta.hot` is set), where they would hijack the test runner's or dev server's own signal handling. `react-router-serve` installs its own handlers that close the server and let in-flight requests finish, so don't call `process.exit` straight away: exit only after the bounded dispose has settled, or let the process end by itself once the server has drained, with an unref'd timer as the forced exit. The development hot-reload dispose already closes the old runtime; make sure the new one doesn't start a second exporter before the old one has flushed.

## Configuration

Read these in the stack's `config.ts` with the other settings, and pass them to the layer as values. Add them, commented out, to `.env.example`, and list them in README.

| Variable | Meaning | Default |
| --- | --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Collector base URL; the layer appends `/v1/traces`, `/v1/logs` and `/v1/metrics` | unset: no exporter |
| `OTEL_EXPORTER_OTLP_HEADERS` | `key=value` pairs, comma separated, for collector auth; a redacted value | none |
| `OTEL_SERVICE_NAME` | `service.name` | the package name |
| `OTEL_RESOURCE_ATTRIBUTES` | `key=value` pairs added to the resource, such as `deployment.environment.name=staging` | none |
| `OTEL_SDK_DISABLED` | `true` turns every exporter off, even with an endpoint | `false` |
| `OTEL_EXPORTER_OTLP_TIMEOUT` | Milliseconds allowed for one export request | 10000 |

`service.version` comes from the package version when `package.json` has one (react-router's has none, so leave it out rather than inventing one), and `deployment.environment.name` from `NODE_ENV` unless the resource attributes set it. Every trace is exported: Effect has no ratio sampler (only a minimum trace level), so README lists `OTEL_TRACES_SAMPLER` and `OTEL_TRACES_SAMPLER_ARG` as unsupported. The other standard variables (per-signal endpoints, protocol selection, batch tuning) are unsupported unless you wire and test them; say so in README rather than implying the whole specification works. An endpoint that isn't a valid URL fails startup visibly, like any other invalid setting. Empty strings count as unset.

## Export limits

- `Otlp.layer*` has no per-request timeout option. Apply `OTEL_EXPORTER_OTLP_TIMEOUT` to the `HttpClient` you give the layer (`HttpClient.timeout` where the installed release has it, otherwise a `transformResponse` that times out the response effect).
- Batch size is bounded (`maxBatchSize`, 512 unless you have a reason) and batches go out on a short interval.
- Check the installed exporter's behavior in `src/observability/OtlpExporter.ts` rather than assuming it: when this guide was written, it retried transient failures a few times, then dropped the buffered batch and stopped exporting for 60 seconds. Telemetry may be dropped; it must not grow memory without limit, retry forever or wait in the request path.
- The shutdown flush has its own timeout (`shutdownTimeout`, 5 seconds unless the deployment needs longer), so an unreachable collector can't hold the process open.

## Request spans, logs and metrics

Exactly one server span per request. Effect's HTTP server middleware opens one by itself when a tracer is present, records `http.request.method`, `url.path`, `url.scheme` and `http.response.status_code` on it, and the router adds `http.route`. Use that span; don't open a second one in your own middleware (or in `runRoute`/`runData` on react-router, where no Effect HTTP server runs: there, open it yourself with the same attributes). Its default name is the bare method (`HttpMiddleware.SpanNameGenerator`); name it `{method} {route}` (`GET /v1/orders/:id`), never the raw path, which carries ids. Attach the request id as an attribute and keep the stack's `x-request-id` header and `request` log line unchanged; logs carry both ids. Incoming `traceparent` headers continue an existing trace.

The middleware also records request and response headers; set `HttpMiddleware.TracerHeaderFilter` to an allowlist. Health probes (`/healthz`) create no span: `HttpMiddleware.layerTracerDisabledForUrls(["/healthz"])` or a `TracerDisabledWhen` predicate. Provide either where the Node server builds its request runtime, not only inside the route layer, and check both the Node listener and the web handler: a route-only setting can leave the server's own spans active, including on health probes.

On React Router, `http.route` needs the matched pattern, and `runRoute`/`runData` only receive the `request` (the stack's `http.ts` logs every non-health path as `/`). Two ways to get it, checked against the installed `react-router` types and its `docs/how-to/instrumentation.md`:

- Pass the loader's or action's `pattern` argument (`LoaderFunctionArgs.pattern`, the un-interpolated route such as `/teams/:teamId`) through to `runRoute`/`runData` and name the span from it.
- Or own the server span in an `instrumentations` export from `app/entry.server.tsx` (`bunx react-router reveal entry.server` creates the file): `handler.instrument({ request })` wraps every document and data request, and its result carries `statusCode` and `meta.pattern`. This also covers 404 and 405 responses that never reach a loader or action; `meta` is undefined for those, so name the span by method alone.

Whichever you choose, a missing route or unsupported method can be answered without reaching a loader or action. Cover those responses at the request boundary or with a fallback route, and test them through the production server as well as direct route calls.

Static assets served by the framework's production server before the router runs are not traced; don't replace that server to trace them.

For a page loader, also forward the request-id response header through the framework's document-header mechanism. Test the actual document response: a header on loader data alone may not reach the browser.

A 5xx response or a defect sets the span's status to error (the server middleware already does this for 5xx); add `error.type` (the status code, or the defect's class) where the installed middleware doesn't. 4xx responses are the client's mistake and leave the status unset. Check the serialized status too: a tracer can mark every successful Effect as OK, including a request that returned 4xx. Keep the client-error status unset in the exported record.

Outbound calls through Effect's HTTP client open a client span and propagate W3C trace context by default (`HttpClient.TracerPropagationEnabled`); don't add headers by hand.

The stack's logger adds `traceId` and `spanId` to each record written while a span is active, as fields the logger owns beside `time`, `level` and `msg`. OTLP log export runs alongside the stack's logger, never instead of it: build the observability layer on top of the logger layer (`Layer.provideMerge`), because a `Logger.layer` built after the OTLP logger replaces it. It sends the same sanitized records: the allowlisted `error` field, no bodies, no credentials.

Record one histogram, `http.server.request.duration`, in seconds, with boundaries in seconds and the unit stated in its description (Effect 4's `Metric.histogram` takes `description`, `attributes` and `boundaries`, with no unit option; check the installed declaration), with `http.request.method`, `http.route`, `http.response.status_code` and, on failures, `error.type` as attributes. Request counts come from the histogram; add no separate counter. Status codes are low-cardinality; ids, raw paths and user input never become attributes, because each distinct value creates a new series in the backend.

## Safe errors

The stack's logs omit a defect's message because it can carry user input. Exported telemetry follows the same rule. The OTLP tracer can put a failed span's cause in its status and exception event, including a stack trace. Before export, replace defect messages with their class name and remove defect stack traces (for example by wrapping the tracer the layer installs). Typed errors have fixed, safe messages and can be exported as they are. Spans and logs never carry request or response bodies, headers outside the allowlist, or credentials.

## Tests

Build fresh layers and a fresh `ConfigProvider` per test; never read the test runner's environment. Go through real HTTP. On typescript-api and astro-fullstack, use the Node server, as the stack's contract tests do. React-router has no HTTP contract tests (`http.test.ts` calls loaders directly), so put a `node:http` server on an ephemeral loopback port in front of the route module's real `loader`/`action` (building the `Request` from the incoming message and passing the matched `pattern`), or in front of `createRequestHandler` from `react-router` over the built server; both keep the request on a real socket.

1. **Span nesting and isolation.** Install an in-memory tracer (a small tracer that records ended spans in an array). One request produces a server span with a child span from a service call. Two concurrent requests produce two traces, each child under its own parent.
2. **Failed request.** A route that dies with a defect whose message contains a marker string ends its server span with error status. Run the same request with the loopback receiver below and assert the marker bytes never appear in any received body.
3. **Loopback export.** Start an HTTP server inside the test on `127.0.0.1` port 0, point the endpoint at it, run a synthetic span, close the layer's scope, and assert the receiver got a POST to `/v1/traces` whose body contains the span's name. Protobuf bodies keep strings as UTF-8, so a byte search works for both wire formats.
4. **Unreachable collector.** Bind a loopback port, close it, and use it as the endpoint. A request still succeeds with its normal status, and closing the layer's scope finishes within the shutdown timeout.
5. **Disabled.** With the endpoint unset, provide an HTTP client that fails the test on any request. Run a request and shut down; the client is never called.

After a failed export the exporter stops exporting for a while, so a test that shares an exporter with an earlier failing test sees nothing. One exporter per test avoids that. Every test closes its server and receiver in a finalizer, including on failure.

## Trying it against a collector

Any OTLP/HTTP collector works, usually on port 4318. Start one locally (an OpenTelemetry Collector or an all-in-one Grafana image), set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` in `.env`, restart the server and make a request. This is a manual check; verify never needs a collector.

## Other telemetry tools

If an error-tracking SDK is added later, start it with error capture only. This layer owns tracing, and two tracers on one request produce duplicate or broken traces.
