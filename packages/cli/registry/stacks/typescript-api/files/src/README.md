# API source

Start with [api.ts](api.ts) and [api/health.ts](api/health.ts) for the HTTP contract,
then follow [handlers/health.ts](handlers/health.ts) into
[services/health.ts](services/health.ts). [schemas/](schemas/) owns request and response
shapes; [errors.ts](errors.ts) maps intentional failures to safe HTTP envelopes.

[app.ts](app.ts) composes those layers with request IDs, body limits and logging.
It stays platform-free so the same app works as a web handler.
[platform/node.ts](platform/node.ts) supplies the Node listener, configuration and
log sinks. Read [config.ts](config.ts) and [logging.ts](logging.ts) for those boundaries.
The acceptance suite is in [../tests/](../tests/).
