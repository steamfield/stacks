//! Liveness: answers while the process serves, without touching the store.

use axum::Json;
use serde_json::{Value, json};

pub async fn check() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}
