//! `/v1/notes`: list, read and create. Each handler extracts, calls the
//! store and returns `Result<_, ApiError>`; `?` maps store errors through
//! the error table.

use std::sync::Arc;

use axum::extract::State;
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use serde::Deserialize;

use crate::error::ApiError;
use crate::extract::{Json, Path, Query};
use crate::notes::{DEFAULT_LIMIT, NewNote, Note, NoteStore, Page};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListParams {
    limit: Option<usize>,
    cursor: Option<String>,
}

pub async fn list<S: NoteStore>(
    State(store): State<Arc<S>>,
    Query(params): Query<ListParams>,
) -> Result<axum::Json<Page>, ApiError> {
    let limit = params.limit.unwrap_or(DEFAULT_LIMIT);
    let page = store.list(limit, params.cursor.as_deref()).await?;
    Ok(axum::Json(page))
}

pub async fn get<S: NoteStore>(
    State(store): State<Arc<S>>,
    Path(id): Path<String>,
) -> Result<axum::Json<Note>, ApiError> {
    Ok(axum::Json(store.get(&id).await?))
}

/// 201 with the note and a `Location` header naming its read route. The body
/// extractor comes last: it consumes the request.
pub async fn create<S: NoteStore>(
    State(store): State<Arc<S>>,
    Json(input): Json<NewNote>,
) -> Result<(StatusCode, HeaderMap, axum::Json<Note>), ApiError> {
    let note = store.create(input).await?;
    let mut headers = HeaderMap::new();
    let location = HeaderValue::try_from(format!("/v1/notes/{}", note.id))
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    headers.insert(header::LOCATION, location);
    Ok((StatusCode::CREATED, headers, axum::Json(note)))
}
