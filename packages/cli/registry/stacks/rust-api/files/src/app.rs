//! The router factory: routes plus the middleware every request passes
//! through. Tests call `router` with their own store to drive the real stack.

use std::any::Any;
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::error_handling::HandleErrorLayer;
use axum::extract::{DefaultBodyLimit, MatchedPath, Request};
use axum::http::{HeaderValue, header};
use axum::response::{IntoResponse, Response};
use tower::{BoxError, ServiceBuilder};
use tower_http::LatencyUnit;
use tower_http::catch_panic::CatchPanicLayer;
use tower_http::request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::{DefaultOnResponse, TraceLayer};
use tracing::Level;

use crate::error::ApiError;
use crate::notes::NoteStore;
use crate::routes::routes;

/// Request bodies above this are 413.
pub const BODY_LIMIT: usize = 1024 * 1024;

pub fn router<S: NoteStore>(store: Arc<S>, request_timeout: Duration) -> Router {
    layer(routes(store), request_timeout)
}

/// Wrap routes in the middleware, outermost first: request id, its echo on
/// the response, the access log, panic recovery, `Cache-Control`, the
/// request timeout and the body limit. Misses and wrong methods get the
/// error envelope too.
fn layer(routes: Router, request_timeout: Duration) -> Router {
    let middleware = ServiceBuilder::new()
        .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
        .layer(PropagateRequestIdLayer::x_request_id())
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(request_span)
                .on_response(
                    DefaultOnResponse::new()
                        .level(Level::INFO)
                        .latency_unit(LatencyUnit::Millis),
                ),
        )
        .layer(CatchPanicLayer::custom(panicked))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store"),
        ))
        .layer(HandleErrorLayer::new(timed_out))
        .timeout(request_timeout)
        .layer(DefaultBodyLimit::max(BODY_LIMIT));
    routes
        .fallback(|| async { ApiError::NotFound })
        .method_not_allowed_fallback(|| async { ApiError::MethodNotAllowed })
        .layer(middleware)
}

/// The access-log span: method, route pattern (never the raw path or query)
/// and request id. The response record adds status and latency.
fn request_span(request: &Request) -> tracing::Span {
    let route = request
        .extensions()
        .get::<MatchedPath>()
        .map_or("unmatched", MatchedPath::as_str);
    let request_id = request
        .headers()
        .get("x-request-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    tracing::info_span!("request", method = %request.method(), route, request_id)
}

async fn timed_out(error: BoxError) -> ApiError {
    ApiError::Unavailable(error.to_string())
}

#[expect(
    clippy::needless_pass_by_value,
    reason = "CatchPanicLayer hands the panic payload over by value"
)]
fn panicked(panic: Box<dyn Any + Send + 'static>) -> Response<Body> {
    let message = panic
        .downcast_ref::<&str>()
        .map(|s| (*s).to_owned())
        .or_else(|| panic.downcast_ref::<String>().cloned())
        .unwrap_or_default();
    ApiError::Internal(format!("handler panicked: {message}")).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::routing::get;
    use tower::ServiceExt;

    async fn call(app: Router, path: &str) -> (u16, serde_json::Value) {
        let response = app
            .oneshot(Request::get(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = response.status().as_u16();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, serde_json::from_slice(&body).unwrap())
    }

    #[tokio::test]
    async fn a_panicking_handler_gets_the_internal_envelope() {
        async fn boom() -> &'static str {
            panic!("boom")
        }
        let app = layer(
            Router::new().route("/boom", get(boom)),
            Duration::from_secs(5),
        );
        let (status, body) = call(app, "/boom").await;
        assert_eq!(status, 500);
        assert_eq!(body["error"]["tag"], "Internal");
    }

    #[tokio::test]
    async fn a_slow_handler_gets_the_retryable_unavailable_envelope() {
        async fn slow() -> &'static str {
            tokio::time::sleep(Duration::from_secs(5)).await;
            "late"
        }
        let app = layer(
            Router::new().route("/slow", get(slow)),
            Duration::from_millis(20),
        );
        let (status, body) = call(app, "/slow").await;
        assert_eq!(status, 503);
        assert_eq!(body["error"]["retryable"], true);
    }
}
