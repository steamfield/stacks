//! Every failure the service reports. `ApiError` is what a request can fail
//! with, mapped to its HTTP status by the one table in `ApiError::row`.
//! `StartError` is what the process can fail with, mapped to an exit status.

use std::io;

use axum::Json;
use axum::extract::rejection::{JsonRejection, PathRejection, QueryRejection};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;

use crate::notes::NoteError;

/// A failed request. The detail a variant carries is logged, never sent:
/// clients get the fixed message from the table.
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("bad input: {0}")]
    BadInput(String),
    #[error("not found")]
    NotFound,
    #[error("method not allowed")]
    MethodNotAllowed,
    #[error("payload too large")]
    PayloadTooLarge,
    #[error("unsupported media type")]
    UnsupportedMediaType,
    #[error("unavailable: {0}")]
    Unavailable(String),
    #[error("internal: {0}")]
    Internal(String),
}

/// One row of the error table: what a client sees for a variant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Row {
    pub status: StatusCode,
    pub tag: &'static str,
    pub message: &'static str,
    pub retryable: bool,
}

impl ApiError {
    /// The error table. A new failure is a new variant and a new row; never
    /// rename a tag, since clients branch on it.
    pub fn row(&self) -> Row {
        let (status, tag, message, retryable) = match self {
            Self::BadInput(_) => (
                StatusCode::BAD_REQUEST,
                "BadInput",
                "Invalid request.",
                false,
            ),
            Self::NotFound => (
                StatusCode::NOT_FOUND,
                "NotFound",
                "Resource not found.",
                false,
            ),
            Self::MethodNotAllowed => (
                StatusCode::METHOD_NOT_ALLOWED,
                "MethodNotAllowed",
                "Method not allowed.",
                false,
            ),
            Self::PayloadTooLarge => (
                StatusCode::PAYLOAD_TOO_LARGE,
                "PayloadTooLarge",
                "Request body is too large.",
                false,
            ),
            Self::UnsupportedMediaType => (
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "UnsupportedMediaType",
                "Expected a JSON body.",
                false,
            ),
            Self::Unavailable(_) => (
                StatusCode::SERVICE_UNAVAILABLE,
                "Unavailable",
                "Service unavailable.",
                true,
            ),
            Self::Internal(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Internal",
                "Internal server error.",
                false,
            ),
        };
        Row {
            status,
            tag,
            message,
            retryable,
        }
    }
}

#[derive(Serialize)]
struct Envelope {
    error: Body,
}

#[derive(Serialize)]
struct Body {
    tag: &'static str,
    message: &'static str,
    retryable: bool,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let row = self.row();
        if row.status.is_server_error() {
            tracing::error!(tag = row.tag, error = %self, "request failed");
        } else {
            tracing::debug!(tag = row.tag, error = %self, "request rejected");
        }
        let envelope = Envelope {
            error: Body {
                tag: row.tag,
                message: row.message,
                retryable: row.retryable,
            },
        };
        (row.status, Json(envelope)).into_response()
    }
}

impl From<NoteError> for ApiError {
    fn from(error: NoteError) -> Self {
        match error {
            NoteError::Invalid(_) | NoteError::BadCursor => Self::BadInput(error.to_string()),
            NoteError::NotFound => Self::NotFound,
        }
    }
}

// axum's own rejections answer in plain text; these send them through the table.

impl From<JsonRejection> for ApiError {
    fn from(rejection: JsonRejection) -> Self {
        match rejection.status() {
            StatusCode::PAYLOAD_TOO_LARGE => Self::PayloadTooLarge,
            StatusCode::UNSUPPORTED_MEDIA_TYPE => Self::UnsupportedMediaType,
            StatusCode::BAD_REQUEST | StatusCode::UNPROCESSABLE_ENTITY => {
                Self::BadInput(rejection.body_text())
            }
            _ => Self::Internal(rejection.body_text()),
        }
    }
}

impl From<QueryRejection> for ApiError {
    fn from(rejection: QueryRejection) -> Self {
        Self::BadInput(rejection.body_text())
    }
}

impl From<PathRejection> for ApiError {
    fn from(rejection: PathRejection) -> Self {
        if rejection.status().is_server_error() {
            Self::Internal(rejection.body_text())
        } else {
            Self::BadInput(rejection.body_text())
        }
    }
}

/// A failure that stops the process, with the exit status it maps to.
#[derive(Debug, thiserror::Error)]
pub enum StartError {
    #[error("unexpected arguments {args:?}; run with no arguments to serve, or --healthcheck")]
    Usage { args: String },
    #[error("invalid setting {name}: {reason}")]
    InvalidSetting { name: &'static str, reason: String },
    #[error("cannot start logging: {0}")]
    Logging(String),
    #[error("cannot start the async runtime: {0}")]
    Runtime(#[source] io::Error),
    #[error("cannot listen on {addr}: {source}")]
    Bind {
        addr: std::net::SocketAddr,
        #[source]
        source: io::Error,
    },
    #[error("server failed: {0}")]
    Serve(#[source] io::Error),
    #[error("requests still running after the {0:?} shutdown timeout")]
    ShutdownTimeout(std::time::Duration),
    #[error("health check failed: {0}")]
    Unhealthy(String),
}

impl StartError {
    /// The `UPPER_SNAKE` code in the failure line. Never reuse or rename one.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Usage { .. } => "USAGE",
            Self::InvalidSetting { .. } => "INVALID_SETTING",
            Self::Logging(_) | Self::Runtime(_) => "STARTUP",
            Self::Bind { .. } => "BIND",
            Self::Serve(_) => "SERVE",
            Self::ShutdownTimeout(_) => "SHUTDOWN_TIMEOUT",
            Self::Unhealthy(_) => "UNHEALTHY",
        }
    }

    /// 2 for a mistake in the invocation, 3 for bad configuration, 1 for anything else.
    pub fn exit_code(&self) -> u8 {
        match self {
            Self::Usage { .. } => 2,
            Self::InvalidSetting { .. } => 3,
            Self::Logging(_)
            | Self::Runtime(_)
            | Self::Bind { .. }
            | Self::Serve(_)
            | Self::ShutdownTimeout(_)
            | Self::Unhealthy(_) => 1,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_variant_has_one_row() {
        let rows = [
            (ApiError::BadInput(String::new()), 400, "BadInput", false),
            (ApiError::NotFound, 404, "NotFound", false),
            (ApiError::MethodNotAllowed, 405, "MethodNotAllowed", false),
            (ApiError::PayloadTooLarge, 413, "PayloadTooLarge", false),
            (
                ApiError::UnsupportedMediaType,
                415,
                "UnsupportedMediaType",
                false,
            ),
            (
                ApiError::Unavailable(String::new()),
                503,
                "Unavailable",
                true,
            ),
            (ApiError::Internal(String::new()), 500, "Internal", false),
        ];
        for (error, status, tag, retryable) in rows {
            let row = error.row();
            assert_eq!(
                (row.status.as_u16(), row.tag, row.retryable),
                (status, tag, retryable)
            );
            assert!(row.message.ends_with('.'), "{tag}");
        }
    }

    #[tokio::test]
    async fn the_envelope_carries_the_row_and_never_the_detail() {
        let response = ApiError::Internal("secret path /etc/x".to_owned()).into_response();
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(
            body,
            r#"{"error":{"tag":"Internal","message":"Internal server error.","retryable":false}}"#
        );
    }

    #[test]
    fn start_failures_map_to_exit_statuses() {
        let usage = StartError::Usage {
            args: "--nope".to_owned(),
        };
        let setting = StartError::InvalidSetting {
            name: "PORT",
            reason: "bad".to_owned(),
        };
        let bind = StartError::Bind {
            addr: ([127, 0, 0, 1], 1).into(),
            source: io::Error::from(io::ErrorKind::AddrInUse),
        };
        assert_eq!((usage.code(), usage.exit_code()), ("USAGE", 2));
        assert_eq!(
            (setting.code(), setting.exit_code()),
            ("INVALID_SETTING", 3)
        );
        assert_eq!((bind.code(), bind.exit_code()), ("BIND", 1));
    }
}
