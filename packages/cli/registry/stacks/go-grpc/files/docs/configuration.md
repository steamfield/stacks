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
| DRAIN_DELAY | 0s | Go duration, zero or more |
| REFLECTION | true | true or false (anything `strconv.ParseBool` accepts) |

An invalid setting fails startup with exit 1 and a JSON log naming the
variable. The `listening` record contains the actual bound address.
`LOG_LEVEL=debug` includes health checks; other RPCs log at info, one `rpc`
record each with procedure, protocol, status code and duration.

Reflection lets grpcurl, buf curl and Postman list and describe services
without the `.proto` files. It describes every protobuf type compiled into the
binary, so set `REFLECTION=false` on an endpoint the public can reach.

On SIGINT or SIGTERM the server reports NOT_SERVING to health checks and keeps
serving for DRAIN_DELAY, so probes see it before the port closes (set it above
the load balancer's probe interval in a deployment). Then it stops accepting
connections, waits for active calls up to SHUTDOWN_TIMEOUT, logs
`stopped` and exits 0. A timeout closes remaining connections and exits 1. A
second signal uses the default signal behavior because the first signal
unregisters the notification handler.

The `-healthcheck` flag calls `grpc.health.v1.Health/Check` over gRPC at HOST
on PORT with a short timeout. Wildcard binds 0.0.0.0 and :: use their IPv4 or
IPv6 loopback address. It exits 0 for SERVING and 1 otherwise, and needs no
shell, curl or grpc_health_probe inside a container. `GET /healthz` answers
200 with `{"status":"serving"}` or 503, for probes that only speak HTTP.
