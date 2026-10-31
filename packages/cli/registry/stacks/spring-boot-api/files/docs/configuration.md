# Configuration

The server reads environment variables at startup. It does not load `.env`:
export variables in the invoking shell or let the deployment runtime supply
them. `.env.example` lists every setting. Leave a variable unset to get its
default; an empty value is not the default.

| Variable | Default | Validation |
|---|---|---|
| `HOST` | `127.0.0.1` | The address to bind; a container uses `0.0.0.0` |
| `PORT` | `8080` | Integer from 0 to 65535; 0 lets the OS choose |
| `SHUTDOWN_TIMEOUT` | `10s` | A duration (`30s`, `1m`): how long a stop waits for requests in flight |
| `APP_DEFAULT_PAGE_SIZE` | `20` | 1 to 1000, at most `APP_MAX_PAGE_SIZE` |
| `APP_MAX_PAGE_SIZE` | `100` | 1 to 1000 |
| `LOGGING_LEVEL_ROOT` | `info` | `trace`, `debug`, `info`, `warn` or `error`; `LOGGING_LEVEL_APP=debug` for this code only |

`HOST`, `PORT` and `SHUTDOWN_TIMEOUT` are mapped onto Spring's own properties
in `src/main/resources/application.yaml`. `APP_*` variables bind to
`app.config.AppProperties` through Spring's relaxed binding
(`APP_MAX_PAGE_SIZE` is `app.max-page-size`). Spring reads its other
properties from the environment the same way, so `SERVER_PORT` would also
work; use the names above.

An invalid setting stops startup before the server listens: Spring prints an
`APPLICATION FAILED TO START` report naming the property and the reason, and
the process exits 1.

Logs are JSON records in Elastic Common Schema on stdout, one per line. Each
request's records carry `requestId`; the access record (`message` `request`)
has `method`, `route` (the pattern, never the raw path or query), `status`
and `durationMs`.

`java -jar target/app.jar --healthcheck` requests `/actuator/health` at
`HOST` and `PORT` with a two second timeout and exits 0 on 200, 1 otherwise.
A wildcard `HOST` (`0.0.0.0`, `::`) is probed on loopback. It starts no
Spring context and needs no shell or curl, so it works as a container's
`HEALTHCHECK`.
