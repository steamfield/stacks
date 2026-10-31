"""The cross-cutting wiring: health, request ids and logs, JSON errors outside DRF, the schema."""

import pytest
import structlog
from django.test import Client, override_settings
from structlog.testing import capture_logs

from tests.assertions import assert_error

# Request ids live in structlog's context variables; merge them as the real chain does.
CONTEXT = [structlog.contextvars.merge_contextvars]


def test_healthz_answers_without_the_database(client: Client) -> None:
    with capture_logs() as logs:
        response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response["Cache-Control"] == "no-store"
    assert [(log["route"], log["log_level"]) for log in logs] == [("/healthz", "debug")]


def test_healthz_refuses_writes(client: Client) -> None:
    assert client.post("/healthz").status_code == 405


def test_request_id_is_generated_or_kept(client: Client) -> None:
    generated = client.get("/healthz")["X-Request-ID"]
    assert len(generated) == 32
    assert client.get("/healthz", headers={"X-Request-ID": "abc-123"})["X-Request-ID"] == "abc-123"
    assert client.get("/healthz", headers={"X-Request-ID": "bad id!"})["X-Request-ID"] != "bad id!"


@pytest.mark.django_db
def test_each_request_logs_one_line_with_its_route(client: Client) -> None:
    with capture_logs(processors=CONTEXT) as logs:
        response = client.get("/v1/notes/42?secret=1", headers={"X-Request-ID": "req-1"})
    (line,) = [log for log in logs if log["event"] == "request"]
    assert line == {
        "event": "request",
        "log_level": "info",
        "method": "GET",
        "route": "/v1/notes/<str:noteId>",
        "status": 400,
        "duration_ms": line["duration_ms"],
        "request_id": "req-1",
    }
    assert response["X-Request-ID"] == "req-1"


@pytest.mark.parametrize("method", ["get", "post", "delete"])
def test_unknown_paths_are_the_json_404(client: Client, method: str) -> None:
    with capture_logs() as logs:
        response = getattr(client, method)("/nope")
    assert_error(response, "NotFound")
    assert logs[-1]["route"] == "<unmatched>"


def test_unknown_hosts_are_the_json_400(client: Client) -> None:
    assert_error(client.get("/healthz", headers={"Host": "evil.example"}), "BadInput")


@override_settings(ROOT_URLCONF="tests.urls_failing")
def test_unexpected_errors_are_the_json_500() -> None:
    client = Client(raise_request_exception=False)
    with capture_logs() as logs:
        response = client.get("/v1/explode")
    assert_error(response, "Internal")
    assert b"secret-sentinel" not in response.content
    line = next(log for log in logs if log["event"] == "request")
    assert line["log_level"] == "error"
    assert line["status"] == 500


def test_the_schema_is_served(client: Client) -> None:
    response = client.get("/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    assert set(schema["paths"]) == {"/v1/notes", "/v1/notes/{noteId}"}


@pytest.mark.django_db  # closing the response fires request_finished, which closes connections
def test_admin_static_files_are_served(client: Client) -> None:
    response = client.get("/static/admin/css/base.css")
    try:
        assert response.status_code == 200
        assert response["Content-Type"].startswith("text/css")
    finally:
        response.close()  # whitenoise streams an open file


def test_wsgi_application_loads() -> None:
    from config.wsgi import application  # noqa: PLC0415 - importing it is the test.

    assert callable(application)
