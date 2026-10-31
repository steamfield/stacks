import asyncio
import json
import re

import pytest
from fastapi import FastAPI, HTTPException, Response
from httpx import AsyncClient
from httpx import Response as HttpResponse

from app.api.notes import get_note_store
from app.errors import ERRORS, AppError, ServiceUnavailable
from app.schemas import Note
from app.services.notes import MemoryNotes
from app.services.notes import Note as StoredNote

pytestmark = pytest.mark.integration

PUBLIC_ERRORS = {
    "VALIDATION_FAILED": (422, "Invalid request.", False),
    "NOT_FOUND": (404, "Resource not found.", False),
    "METHOD_NOT_ALLOWED": (405, "Method not allowed.", False),
    "CONFLICT": (409, "Resource conflict.", False),
    "UNAUTHORIZED": (401, "Authentication required.", False),
    "FORBIDDEN": (403, "Access denied.", False),
    "UNSUPPORTED_MEDIA_TYPE": (415, "Expected a JSON body.", False),
    "INTERNAL_ERROR": (500, "Internal server error.", False),
    "UNAVAILABLE": (503, "Service unavailable.", True),
}


def assert_error(response: HttpResponse, status: int, tag: str) -> None:
    assert response.status_code == status
    expected_status, message, _retryable = PUBLIC_ERRORS[tag]
    assert status == expected_status
    assert response.json() == {
        "error": {
            "code": tag,
            "message": message,
            "details": None,
            "requestId": response.headers["x-request-id"],
        }
    }
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-request-id"]


async def test_health(client: AsyncClient) -> None:
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["cache-control"] == "no-store"


async def test_cors_allows_only_configured_origins(client: AsyncClient) -> None:
    allowed = await client.get("/health", headers={"origin": "http://localhost:5173"})
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert allowed.headers["access-control-expose-headers"] == "X-Request-ID"
    denied = await client.get("/health", headers={"origin": "https://untrusted.example"})
    assert "access-control-allow-origin" not in denied.headers
    preflight = await client.options(
        "/api/v1/notes",
        headers={
            "origin": "http://localhost:5173",
            "access-control-request-method": "POST",
            "access-control-request-headers": "Content-Type",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == "http://localhost:5173"


async def test_create_read_list_and_pagination(client: AsyncClient) -> None:
    first = await client.post("/api/v1/notes", json={"title": " First ", "body": "Body"})
    assert first.status_code == 201
    note = first.json()
    assert note["title"] == "First"
    assert note["body"] == "Body"
    assert set(note) == {"id", "title", "body", "createdAt"}
    assert note["createdAt"].endswith("Z")
    assert (await client.get(first.headers["location"])).json() == note
    second = await client.post("/api/v1/notes", json={"title": "Second"})
    page = (await client.get("/api/v1/notes", params={"limit": 1})).json()
    assert page["items"] == [note]
    last = await client.get("/api/v1/notes", params={"limit": 1, "cursor": page["nextCursor"]})
    assert last.json() == {"items": [second.json()]}


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"title": ""},
        {"title": " "},
        {"title": "x" * 201},
        {"title": "ok", "body": "x" * 10001},
        {"title": "ok", "extra": True},
    ],
)
async def test_invalid_body(client: AsyncClient, payload: dict[str, object]) -> None:
    assert_error(await client.post("/api/v1/notes", json=payload), 422, "VALIDATION_FAILED")


@pytest.mark.parametrize(
    "path,status,tag",
    [
        ("/missing", 404, "NOT_FOUND"),
        ("/api/v1/notes/missing", 404, "NOT_FOUND"),
        ("/api/v1/notes?limit=0", 422, "VALIDATION_FAILED"),
        ("/api/v1/notes?limit=101", 422, "VALIDATION_FAILED"),
        ("/api/v1/notes?cursor=!", 422, "VALIDATION_FAILED"),
        ("/api/v1/notes?surprise=yes", 422, "VALIDATION_FAILED"),
        ("/health?surprise=yes", 422, "VALIDATION_FAILED"),
        ("/api/v1/notes/missing?surprise=yes", 422, "VALIDATION_FAILED"),
        ("/api/v1/notes/", 404, "NOT_FOUND"),
    ],
)
async def test_request_failures(client: AsyncClient, path: str, status: int, tag: str) -> None:
    assert_error(await client.get(path), status, tag)


async def test_method_and_decoding(client: AsyncClient) -> None:
    assert_error(
        await client.post("/api/v1/notes?surprise=yes", json={"title": "ok"}),
        422,
        "VALIDATION_FAILED",
    )
    wrong = await client.delete("/api/v1/notes")
    assert_error(wrong, 405, "METHOD_NOT_ALLOWED")
    assert {method.strip() for method in wrong.headers["allow"].split(",")} == {"GET", "POST"}
    assert_error(
        await client.post(
            "/api/v1/notes", content="{", headers={"content-type": "application/json"}
        ),
        422,
        "VALIDATION_FAILED",
    )


@pytest.mark.parametrize("media_type", ["text/plain", "application/vnd.api+json"])
@pytest.mark.parametrize("body", ['{"title":"ok"}', "{"])
async def test_media_type_is_checked_before_decoding(
    client: AsyncClient, media_type: str, body: str
) -> None:
    response = await client.post(
        "/api/v1/notes", content=body, headers={"content-type": media_type}
    )
    assert_error(response, 415, "UNSUPPORTED_MEDIA_TYPE")


async def test_dependency_unavailable(app: FastAPI, client: AsyncClient) -> None:
    class UnavailableNotes(MemoryNotes):
        async def get(self, note_id: str) -> StoredNote:
            raise ServiceUnavailable()

    app.dependency_overrides[get_note_store] = UnavailableNotes
    assert_error(await client.get("/api/v1/notes/any"), 503, "UNAVAILABLE")


async def test_unexpected_failure_and_response_encoding(
    app: FastAPI, client: AsyncClient, capsys: pytest.CaptureFixture[str]
) -> None:
    @app.get("/broken", tags=["test"])
    async def broken() -> None:
        raise RuntimeError("secret-sentinel")

    @app.get("/invalid-response", response_model=Note, tags=["test"])
    async def invalid_response() -> dict[str, str]:
        return {"secret": "secret-sentinel"}

    for path in ["/broken", "/invalid-response"]:
        response = await client.get(path, headers={"x-request-id": "failure-id"})
        assert_error(response, 500, "INTERNAL_ERROR")
        assert response.headers["x-request-id"] == "failure-id"
    output = capsys.readouterr().out
    assert "secret-sentinel" not in output
    records = [json.loads(line) for line in output.splitlines()]
    assert len(records) == 2
    assert {record["error"]["class"] for record in records} == {
        "RuntimeError",
        "ResponseValidationError",
    }
    assert all(record["request_id"] == "failure-id" for record in records)


async def test_error_table_and_http_exception(app: FastAPI, client: AsyncClient) -> None:
    @app.get("/failure/{tag}", tags=["test"])
    async def failure(tag: str) -> None:
        raise AppError(tag)

    @app.get("/http-failure", tags=["test"])
    async def http_failure() -> None:
        raise HTTPException(401, detail="secret-sentinel", headers={"WWW-Authenticate": "Bearer"})

    assert set(ERRORS) == set(PUBLIC_ERRORS)
    for tag, (status, _, _) in PUBLIC_ERRORS.items():
        assert_error(await client.get(f"/failure/{tag}"), status, tag)
    assert_error(await client.get("/failure/unknown"), 500, "INTERNAL_ERROR")
    response = await client.get("/http-failure")
    assert_error(response, 401, "UNAUTHORIZED")
    assert response.headers["www-authenticate"] == "Bearer"


async def test_request_ids_logs_and_cache_policy(
    app: FastAPI, client: AsyncClient, capsys: pytest.CaptureFixture[str]
) -> None:
    @app.get("/cached", tags=["test"])
    async def cached() -> Response:
        return Response(status_code=304, headers={"ETag": '"one"'})

    @app.get("/policy", tags=["test"])
    async def policy() -> Response:
        return Response(headers={"Cache-Control": "private, max-age=60"})

    sent = await client.get("/health", headers={"x-request-id": "supplied-id"})
    assert sent.headers["x-request-id"] == "supplied-id"
    for value in ["", "bad id", "x" * 65]:
        response = await client.get("/health", headers={"x-request-id": value})
        assert re.fullmatch("[a-f0-9]{32}", response.headers["x-request-id"])
    responses = await asyncio.gather(
        *(
            client.get("/api/v1/notes/missing", headers={"x-request-id": f"concurrent-{i}"})
            for i in range(5)
        )
    )
    assert [r.headers["x-request-id"] for r in responses] == [f"concurrent-{i}" for i in range(5)]
    assert "cache-control" not in (await client.get("/cached")).headers
    assert (await client.get("/policy")).headers["cache-control"] == "private, max-age=60"
    records = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert len(records) == 11
    for record in records:
        assert record["event"] == "request"
        assert record["duration_ms"] >= 0
        assert record["method"] == "GET"
    assert all(r["route"] == "/api/v1/notes/{noteId}" for r in records if r["status"] == 404)


async def test_openapi_documents_responses_and_stable_operation_ids(
    client: AsyncClient,
) -> None:
    spec = (await client.get("/openapi.json")).json()
    create = spec["paths"]["/api/v1/notes"]["post"]
    assert create["operationId"] == "notes_create"
    for status in ["404", "422", "500"]:
        schema = create["responses"][status]["content"]["application/json"]["schema"]
        assert schema["$ref"].endswith("/ErrorEnvelope")
    properties = spec["components"]["schemas"]["PublicError"]["properties"]
    assert set(properties) == {"code", "message", "details", "requestId"}
