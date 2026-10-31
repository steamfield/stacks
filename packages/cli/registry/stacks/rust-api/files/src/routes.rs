//! Every route, in one table. Middleware is added by `app::router`, not here.

pub mod health;
pub mod notes;

use std::sync::Arc;

use axum::Router;
use axum::routing::get;

use crate::notes::NoteStore;

pub fn routes<S: NoteStore>(store: Arc<S>) -> Router {
    Router::new()
        .route("/healthz", get(health::check))
        .route("/v1/notes", get(notes::list::<S>).post(notes::create::<S>))
        .route("/v1/notes/{noteId}", get(notes::get::<S>))
        .with_state(store)
}
