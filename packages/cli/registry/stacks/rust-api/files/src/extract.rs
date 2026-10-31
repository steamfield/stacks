//! Request extractors whose rejections are `ApiError`s, so a malformed body,
//! query or path gets the same envelope as every other failure. Handlers use
//! these instead of axum's `Json`, `Query` and `Path`.

use axum::extract::{FromRequest, FromRequestParts};

use crate::error::ApiError;

/// A JSON request body. Needs `Content-Type: application/json`; the body limit
/// and unknown-field rules come from the target type and the router.
#[derive(Debug, FromRequest)]
#[from_request(via(axum::Json), rejection(ApiError))]
pub struct Json<T>(pub T);

/// Query parameters. Give the target type `#[serde(deny_unknown_fields)]`.
#[derive(Debug, FromRequestParts)]
#[from_request(via(axum::extract::Query), rejection(ApiError))]
pub struct Query<T>(pub T);

/// Path parameters.
#[derive(Debug, FromRequestParts)]
#[from_request(via(axum::extract::Path), rejection(ApiError))]
pub struct Path<T>(pub T);
