//! The real router and middleware, driven in process with `oneshot`: one
//! request per call, no socket. Each route's success and failure cases.
//!
//! Helpers return `Result` and tests use `?`: clippy's unwrap allowance covers
//! `#[test]` functions, not helpers in an integration test file.

use std::sync::Arc;
use std::time::Duration;

use api::app::{BODY_LIMIT, router};
use api::notes::MemoryStore;
use axum::Router;
use axum::body::Body;
use axum::http::{Method, Request, Response, header};
use serde_json::{Value, json};
use tower::ServiceExt;

type TestResult<T = ()> = Result<T, Box<dyn std::error::Error>>;

fn app() -> Router {
    router(Arc::new(MemoryStore::default()), Duration::from_secs(5))
}

/// Send one request; return the response head and its body as JSON
/// (`Null` when empty).
async fn send(app: &Router, request: Request<Body>) -> TestResult<(Response<()>, Value)> {
    let response = app.clone().oneshot(request).await?;
    let (parts, body) = response.into_parts();
    let bytes = axum::body::to_bytes(body, usize::MAX).await?;
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes)?
    };
    Ok((Response::from_parts(parts, ()), value))
}

fn request(method: Method, path: &str) -> TestResult<Request<Body>> {
    Ok(Request::builder()
        .method(method)
        .uri(path)
        .body(Body::empty())?)
}

fn post_json(path: &str, body: impl Into<Body>) -> TestResult<Request<Body>> {
    Ok(Request::post(path)
        .header(header::CONTENT_TYPE, "application/json")
        .body(body.into())?)
}

fn header_of<'a>(response: &'a Response<()>, name: &str) -> &'a str {
    response
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
}

fn assert_error(response: &Response<()>, body: &Value, status: u16, tag: &str) {
    assert_eq!(response.status().as_u16(), status, "{body}");
    assert_eq!(body["error"]["tag"], tag, "{body}");
    assert!(body["error"]["message"].is_string(), "{body}");
    assert!(body["error"]["retryable"].is_boolean(), "{body}");
    assert_eq!(header_of(response, "content-type"), "application/json");
}

#[tokio::test]
async fn health_answers_ok_with_no_store_and_a_request_id() -> TestResult {
    let (response, body) = send(&app(), request(Method::GET, "/healthz")?).await?;
    assert_eq!(response.status(), 200);
    assert_eq!(body, json!({ "status": "ok" }));
    assert_eq!(header_of(&response, "cache-control"), "no-store");
    assert_ne!(header_of(&response, "x-request-id"), "");
    Ok(())
}

#[tokio::test]
async fn an_incoming_request_id_is_echoed() -> TestResult {
    let mut probe = request(Method::GET, "/healthz")?;
    probe
        .headers_mut()
        .insert("x-request-id", "trace-123".parse()?);
    let (response, _) = send(&app(), probe).await?;
    assert_eq!(header_of(&response, "x-request-id"), "trace-123");
    Ok(())
}

#[tokio::test]
async fn create_then_read_then_list() -> TestResult {
    let app = app();
    let create = post_json("/v1/notes", r#"{"title":"  First  ","body":"hello"}"#)?;
    let (created, note) = send(&app, create).await?;
    assert_eq!(created.status(), 201);
    assert_eq!(note["title"], "First");
    let id = note["id"].as_str().unwrap_or_default();
    assert_eq!(header_of(&created, "location"), format!("/v1/notes/{id}"));

    let (read, same) = send(&app, request(Method::GET, &format!("/v1/notes/{id}"))?).await?;
    assert_eq!(read.status(), 200);
    assert_eq!(same, note);

    let (listed, page) = send(&app, request(Method::GET, "/v1/notes")?).await?;
    assert_eq!(listed.status(), 200);
    assert_eq!(page, json!({ "items": [note] }));
    Ok(())
}

#[tokio::test]
async fn lists_page_with_an_opaque_cursor() -> TestResult {
    let app = app();
    for title in ["a", "b", "c"] {
        let body = json!({ "title": title }).to_string();
        send(&app, post_json("/v1/notes", body)?).await?;
    }
    let (_, first) = send(&app, request(Method::GET, "/v1/notes?limit=2")?).await?;
    assert_eq!(first["items"].as_array().map(Vec::len), Some(2));
    let cursor = first["nextCursor"].as_str().unwrap_or_default();
    let next = format!("/v1/notes?limit=2&cursor={cursor}");
    let (_, last) = send(&app, request(Method::GET, &next)?).await?;
    assert_eq!(last["items"][0]["title"], "c");
    assert!(last.get("nextCursor").is_none(), "{last}");
    Ok(())
}

#[tokio::test]
async fn bad_queries_are_bad_input() -> TestResult {
    for query in [
        "limit=0",
        "limit=101",
        "limit=ten",
        "limit=",
        "cursor=nope",
        "sort=title",
        "limit=1&limit=2",
    ] {
        let path = format!("/v1/notes?{query}");
        let (response, body) = send(&app(), request(Method::GET, &path)?).await?;
        assert_error(&response, &body, 400, "BadInput");
    }
    Ok(())
}

#[tokio::test]
async fn bad_bodies_get_the_envelope_with_their_status() -> TestResult {
    let app = app();
    let mut plain_text = post_json("/v1/notes", r#"{"title":"x"}"#)?;
    plain_text
        .headers_mut()
        .insert(header::CONTENT_TYPE, "text/plain".parse()?);
    let too_large = json!({ "title": "x", "body": "b".repeat(BODY_LIMIT) }).to_string();
    let cases = [
        (post_json("/v1/notes", "{")?, 400, "BadInput"),
        (
            post_json("/v1/notes", r#"{"title":"x","extra":1}"#)?,
            400,
            "BadInput",
        ),
        (
            post_json("/v1/notes", r#"{"title":"   "}"#)?,
            400,
            "BadInput",
        ),
        (post_json("/v1/notes", r#"{"title":7}"#)?, 400, "BadInput"),
        (post_json("/v1/notes", "[]")?, 400, "BadInput"),
        (plain_text, 415, "UnsupportedMediaType"),
        (post_json("/v1/notes", too_large)?, 413, "PayloadTooLarge"),
    ];
    for (request, status, tag) in cases {
        let (response, body) = send(&app, request).await?;
        assert_error(&response, &body, status, tag);
    }
    Ok(())
}

#[tokio::test]
async fn misses_and_wrong_methods_get_the_envelope() -> TestResult {
    let app = app();
    let unknown_note = request(Method::GET, "/v1/notes/0000000000000099")?;
    let (response, body) = send(&app, unknown_note).await?;
    assert_error(&response, &body, 404, "NotFound");
    let (response, body) = send(&app, request(Method::GET, "/nowhere")?).await?;
    assert_error(&response, &body, 404, "NotFound");
    let (response, body) = send(&app, request(Method::DELETE, "/v1/notes")?).await?;
    assert_error(&response, &body, 405, "MethodNotAllowed");
    assert_eq!(header_of(&response, "allow"), "GET,HEAD,POST");
    Ok(())
}

#[tokio::test]
async fn head_is_answered_like_get_without_a_body() -> TestResult {
    let (response, body) = send(&app(), request(Method::HEAD, "/healthz")?).await?;
    assert_eq!(response.status(), 200);
    assert_eq!(body, Value::Null);
    Ok(())
}
