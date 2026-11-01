# Configuration

The server reads environment variables at startup. Empty values use defaults.
It does not load `.env`: export variables in the invoking shell or let the
deployment runtime supply them. `.env.example` lists every setting.

| Variable | Default | Validation |
|---|---|---|
| HOST | 127.0.0.1 | IPv4 or IPv6 address; use 0.0.0.0 in a container |
| PORT | 8080 | Integer from 0 to 65535; 0 chooses a free port |
| LOG_LEVEL | info | debug, info, warn or error, lowercase |
| SHUTDOWN_TIMEOUT | 10s | Positive Go duration |

An invalid setting fails startup with exit 1 and a JSON log naming the
variable. The `listening` record contains the actual bound address. Page
requests and form posts log at info; `LOG_LEVEL=debug` adds health checks and
static files. Each `request` record has the method, route pattern, status,
whether htmx sent it, duration, bytes and request id, never form values.

On SIGINT or SIGTERM the server stops accepting requests, waits for active
requests up to SHUTDOWN_TIMEOUT, logs `stopped` and exits 0. A timeout closes
remaining connections and exits 1.

The `-healthcheck` flag requests `/healthz` at HOST on PORT with a short
timeout and exits 0 for HTTP 200, 1 otherwise. Wildcard binds 0.0.0.0 and ::
use their loopback address for the probe. It needs no shell or curl inside a
container.
