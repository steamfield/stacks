---
name: add-route
description: Add an HTTP route or a new resource to this Axum API with its store, error mapping and tests. Use when the user asks for a new endpoint, resource, field or HTTP method.
---

# Add a route

The notes resource is the worked example: `src/notes.rs` (types, validation, the `NoteStore` trait and `MemoryStore`), `src/routes/notes.rs` (handlers), the route table in `src/routes.rs`, and its cases in `tests/http.rs`. Follow the same path.

1. **Domain.** A new resource gets `src/<resource>.rs` beside `notes.rs`: a `Serialize` type for responses, a `Deserialize` input with `#[serde(deny_unknown_fields)]` and a `validate` method, its own `thiserror` error enum, and a store trait whose methods return `impl Future<Output = Result<_, _>> + Send`. It never imports axum. A new field on notes goes in `Note`, `NewNote` and `validate`.
2. **Errors.** Map the resource's error into `ApiError` with a `From` impl in `src/error.rs`, choosing an existing variant. A status the table lacks is a new `ApiError` variant and a new arm in `ApiError::row` (status, tag, fixed message, retryable), plus a row in `docs/http-api.md`.
3. **Handler.** In `src/routes/<resource>.rs`, an `async fn` per operation returning `Result<_, ApiError>`. Extract with `crate::extract::{Json, Path, Query}`, never axum's own (their rejections bypass the envelope). `State` first, the `Json` body last. Respond with `axum::Json`; a create returns `StatusCode::CREATED` and a `Location` header. No blocking calls: use tokio's file and time APIs or `tokio::task::spawn_blocking`.
4. **Route.** Add it to the table in `src/routes.rs` under `/v1/<plural-noun>`, with the path parameter named for the resource (`{orderId}`). Put the store in the router's state the way `routes()` does for notes, and build it in `server::run`.
5. **Test.** In `tests/http.rs`, a success case and one case per failure (bad body, bad query, unknown id, wrong method), each asserting status, the envelope's `tag` and any header. Unit-test validation and paging beside the store.
6. Update `docs/http-api.md`, then run `make lint test`.
