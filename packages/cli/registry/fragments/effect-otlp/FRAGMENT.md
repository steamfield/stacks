---
schema_version: 1
id: effect-otlp
kind: fragment
category: tooling
name: OpenTelemetry (OTLP) for Effect servers
description: OpenTelemetry traces, logs and metrics over OTLP for the Effect server in typescript-api, astro-fullstack and react-router, on Effect's own exporters. One observability layer adds trace ids to the existing logs, exports nothing without an endpoint, and is tested with an in-memory tracer and a loopback OTLP receiver.
tags: [typescript, effect, observability, opentelemetry, tracing]
applies_to: [typescript-api, astro-fullstack, react-router]
requires: []
decisions:
  - "Wire format: OTLP over HTTP with protobuf bodies (default, `Otlp.layerProtobuf`, what collectors accept without configuration), or JSON bodies (`Otlp.layerJson`) when the collector accepts only JSON."
verify:
  - { name: telemetry, layer: test, run: bun run test:telemetry }
commands:
  test:telemetry: Run the tracing and OTLP export tests
---

# OpenTelemetry for Effect servers

Read `docs/guidance/effect-otlp/index.md` before implementation; it has the per-stack layout, the supported variables, the span and metric attribute names and the test cases.

The server process exports traces, logs and metrics over OTLP/HTTP to the collector `OTEL_EXPORTER_OTLP_ENDPOINT` names. Business code keeps using Effect's own spans, log functions and metrics; only one observability layer knows about OTLP. With the endpoint unset nothing is exported, so development and tests need no collector, account or Docker.

## The API

Build the layer with `Otlp.layerProtobuf` (or `layerJson`) from `effect/observability`, passing values `config.ts` parsed and always `resource.serviceName`. Don't rely on `Otlp.layerFromConfig`: unlike the specification, it exports nothing unless `OTEL_<SIGNAL>_EXPORTER=otlp` is set. Add neither `@effect/opentelemetry` nor the OpenTelemetry JS SDK.
<!-- stacks:when with=effect -->
Record the names you used in `docs/guidance/effect/api.md`.
<!-- stacks:end -->

## What to add

One `observability.ts` layer, provided where the server builds its runtime:

<!-- stacks:when stack=typescript-api -->
`src/observability.ts`, provided by `src/platform/node.ts`. The test is `tests/telemetry.test.ts`.
<!-- stacks:end -->
<!-- stacks:when stack=astro-fullstack -->
`apps/api/src/observability.ts`, provided by `apps/api/src/platform/node.ts`. The test is `apps/api/tests/telemetry.test.ts` in the `api` Vitest project. The site and the contract never import it, and no OTEL variable gets the `PUBLIC_` prefix.
<!-- stacks:end -->
<!-- stacks:when stack=react-router -->
`app/.server/observability.ts`, built on top of the logger layer in `runtime.ts`'s `AppLayer` (`Layer.provideMerge(logging)`), never beside it: the stack's `Logger.layer` replaces the logger set, so a sibling OTLP logger silently exports nothing. The test is `tests/telemetry.test.ts`. Only `app/.server/` imports it, so no exporter setting reaches the browser bundle. The framework's server doesn't dispose the runtime on exit: in production only (not under Vitest or Vite's dev server), dispose it on SIGTERM and SIGINT, bounded by the shutdown timeout, so the last batch is sent.
<!-- stacks:end -->

Add a `test:telemetry` package script running the stack's Vitest command on that file. The layer:

- Gets its settings from `config.ts`, headers redacted, supporting only the variables the guidance lists (sampling is unsupported: every trace is exported).
- Builds no exporter and makes no network call when the endpoint is unset or `OTEL_SDK_DISABLED` is true.
- Bounds the batch size, gives the exporter's HTTP client a request timeout (the layer has none), and drops telemetry when the collector is down. A slow or missing collector never delays or fails a request.
- Flushes in the shutdown scope with its own timeout.

Each request gets exactly one server span, named `{method} {route}` and carrying the request id; 5xx and defects mark it as an error, and health probes aren't traced. Request metrics are one `http.server.request.duration` histogram, never labelled with ids. Log records gain `traceId` and `spanId`; `x-request-id` and the `request` log line stay. Exported spans and logs carry no bodies, credentials or defect messages.

## Testing and verify

Verify's `telemetry` step runs `test:telemetry`. Build fresh layers and one exporter per test (a failed export disables an exporter for a while), and go through real HTTP on the Node server:

- A request's server span is the parent of a service span, and two concurrent requests produce separate traces (in-memory tracer).
- A defect ends the server span with error status, and its message never reaches the receiver.
- An in-test HTTP server on an ephemeral loopback port receives an export containing a synthetic span.
- With the endpoint on a closed loopback port, the request still succeeds and shutdown finishes within its timeout.
- With the endpoint unset, an HTTP client that fails the test on any call is never called.

## AGENTS.md

Add an Observability section: the layer's file, the supported variables, that an unset endpoint exports nothing, the trace fields in logs, and how to point the server at a local collector.
