# Configuration

The server reads environment variables at startup. Empty values use the
default. It does not load `.env`: export variables in the invoking shell or
let the deployment runtime supply them. `.env.example` lists every setting.

| Variable | Default | Validation |
|---|---|---|
| `HOST` | `127.0.0.1` | IPv4 or IPv6 address; a container uses `0.0.0.0` |
| `PORT` | `8080` | Integer from 0 to 65535; 0 lets the OS choose |
| `RUST_LOG` | `info` | A tracing filter (`debug`, `api=debug,tower_http=info`) |
| `REQUEST_TIMEOUT_SECS` | `10` | Whole seconds from 1 to 3600 |
| `SHUTDOWN_TIMEOUT_SECS` | `10` | Whole seconds from 1 to 3600 |

An invalid setting stops startup with exit status 3 and one line on stderr,
`error[INVALID_SETTING]: invalid setting <NAME>: <reason>`. Logs are JSON
records on stderr, one per line. The `listening` record carries the bound
address in `addr`, which is the real port when `PORT=0`.

On SIGINT or SIGTERM the server stops accepting connections, waits for
requests in flight up to `SHUTDOWN_TIMEOUT_SECS`, logs `stopped` and exits 0.
If requests are still running at the deadline it exits 1.

| Exit status | Meaning |
|---|---|
| 0 | Stopped cleanly after a signal; or `--healthcheck` got 200 |
| 1 | Runtime failure: bind, serve or shutdown timeout; or an unhealthy `--healthcheck` |
| 2 | Unexpected arguments |
| 3 | Invalid setting |

`<binary> --healthcheck` requests `/healthz` at `HOST` and `PORT` with a two
second timeout and exits 0 on 200, 1 otherwise. A wildcard `HOST` (`0.0.0.0`,
`::`) is probed on loopback. It needs no shell or curl, so it works as a
distroless container's `HEALTHCHECK`.
