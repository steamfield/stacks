# API implementation

Start with the [shared contract](../../../packages/contract/index.ts), then follow
[handlers/health.ts](handlers/health.ts) into [services/health.ts](services/health.ts).
The contract owns public schemas and errors; this workspace owns their implementation.

[app.ts](app.ts) composes handlers and request middleware, including optional
static-site serving that keeps API paths separate from page fallback.
[config.ts](config.ts) validates settings and [logging.ts](logging.ts) shapes safe
records. Their unit tests sit beside them.

[platform/node.ts](platform/node.ts) supplies the listener and log sinks.
The app also runs as a web handler; [../tests/](../tests/) checks both transports.
