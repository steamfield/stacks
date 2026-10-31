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
variable. The `listening` record contains the actual bound address.
`LOG_LEVEL=debug` includes health requests; other requests log at info.

On SIGINT or SIGTERM the server stops accepting requests, waits for active
requests up to SHUTDOWN_TIMEOUT, logs `stopped` and exits 0. A timeout closes
remaining connections and exits 1. A second signal uses the default signal
behavior because the first signal unregisters the notification handler.

The `-healthcheck` flag requests `/healthz` at HOST on PORT with a short
timeout. Wildcard binds 0.0.0.0 and :: use their IPv4 or IPv6 loopback address
for the probe. It exits 0 for HTTP 200 and 1 otherwise. This needs no shell or curl
inside a container. PORT=0 is useful for servers in tests, but a healthcheck
must receive the actual port from the server's listening record.
