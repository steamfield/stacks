# API source

Start with [app.ts](app.ts), which assembles middleware, routes, the OpenAPI
document and error handling as a fetch handler. [main.ts](main.ts) loads
environment settings and handles signals; [server.ts](server.ts) adapts the app
to Node HTTP.

[router.ts](router.ts) supplies the validation hook every route uses.
[routes/](routes/README.md) connects schemas in `schemas/notes.ts` to the store in
[services/](services/README.md). [errors.ts](errors.ts) owns safe statuses and
envelopes; [logging.ts](logging.ts) owns pino and request records.
[config.ts](config.ts) validates startup settings.

Unit tests sit beside modules; `../tests/` checks the HTTP contract and real socket.

