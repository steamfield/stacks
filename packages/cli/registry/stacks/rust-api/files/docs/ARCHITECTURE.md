# Architecture

One package with a library and a binary. `src/main.rs` reads the process
(arguments and environment) and calls `api::run` (`src/lib.rs`), which either
serves or runs `--healthcheck`, and returns the exit status. Every module is
in the library, so `tests/http.rs` drives the real router in process.

Serving: `config::Config::load` validates the environment, `logging::init`
installs the JSON subscriber, and `server::run` binds, logs `listening` with
the real address, and serves `app::router` until `server::shutdown_signal`
(SIGINT, or SIGTERM on Unix) resolves. It then drains requests in flight up to
the shutdown timeout and logs `stopped`.

| Module | Owns |
|---|---|
| `lib.rs` | `run`: the mode (serve or `--healthcheck`) and the exit status |
| `config.rs` | `Env` (the captured environment), `Config`, its defaults and validation |
| `error.rs` | `ApiError` and its status table (`row`), rejection mapping, the envelope; `StartError` and its exit statuses |
| `logging.rs` | The process-wide tracing subscriber: JSON on stderr, filtered by `RUST_LOG` |
| `server.rs` | Bind, serve, graceful shutdown and its deadline, signals |
| `app.rs` | `router`: routes plus every middleware layer, the 404 and 405 fallbacks |
| `routes.rs`, `routes/` | The route table and one module of handlers per resource |
| `extract.rs` | `Json`, `Query` and `Path` whose rejections are `ApiError`s |
| `notes.rs` | The notes resource: types, validation, `NoteStore` and `MemoryStore` |
| `probe.rs` | `--healthcheck`: one HTTP/1.1 GET of `/healthz` over a plain TCP socket |

Dependencies point one way: `routes` uses `notes`, `error` and `extract`;
`notes` imports nothing from HTTP, so a database store replaces `MemoryStore`
behind `NoteStore` without touching handlers. Handlers are generic over the
store (`list::<S>`), and the route table names the concrete type once.

Tests: unit tests sit in each module (config parsing, the error table, store
validation and paging, panic and timeout envelopes, bind failure).
`tests/http.rs` sends requests through `app::router` with `tower`'s `oneshot`.
`tests/binary.rs` starts the built binary on a free port, reads its
`listening` record, runs `--healthcheck` against it and stops it with SIGTERM
and SIGINT. No external service is needed.
