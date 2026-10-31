# Configuration

The server reads environment variables at startup, and a `.env` file in the
directory it starts from (Quarkus loads it; it is git-ignored).
`.env.example` lists every setting. Leave a variable unset to get its
default; an empty value is not the default.

| Variable | Default | Validation |
|---|---|---|
| `HOST` | `127.0.0.1` | The address to bind; a container uses `0.0.0.0` |
| `PORT` | `8080` | Integer from 0 to 65535; 0 lets the OS choose |
| `SHUTDOWN_TIMEOUT` | `10s` | A duration (`30s`, `1m`): how long a stop waits for requests in flight |
| `APP_DEFAULT_PAGE_SIZE` | `20` | 1 to 1000, at most `APP_MAX_PAGE_SIZE` |
| `APP_MAX_PAGE_SIZE` | `100` | 1 to 1000 |
| `LOG_LEVEL` | `INFO` | `TRACE`, `DEBUG`, `INFO`, `WARN` or `ERROR`; `QUARKUS_LOG_CATEGORY__APP__LEVEL=DEBUG` for this code only |

`HOST`, `PORT`, `SHUTDOWN_TIMEOUT` and `LOG_LEVEL` are mapped onto Quarkus's
own properties in `src/main/resources/application.properties`. `APP_*`
variables map to `app.config.AppConfig` (`APP_MAX_PAGE_SIZE` is
`app.max-page-size`). Quarkus reads its other properties from the
environment the same way, so `QUARKUS_HTTP_PORT` would also work; use the
names above. Tests never read `PORT`: `quarkus.http.test-port=0` gives each
test run a free port.

An invalid setting stops startup before the server listens: Quarkus logs a
configuration error naming the property and the reason, and the process
exits 1.

Logs are JSON records in Elastic Common Schema on stdout, one per line. Each
request's records carry `requestId` under `mdc`; the access record
(`message` `request`) also has `method`, `route` (the template, never the
raw path or query), `status` and `durationMs` there.

`java -jar target/quarkus-app/quarkus-run.jar --healthcheck` requests
`/q/health/ready` at `HOST` and `PORT` with a two second timeout and exits 0
on 200, 1 otherwise. A wildcard `HOST` (`0.0.0.0`, `::`) is probed on
loopback. It starts no Quarkus runtime and needs no shell or curl, so it
works as a container's `HEALTHCHECK`.
