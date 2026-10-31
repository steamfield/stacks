"""The notes resource through DRF's API client against a real test database."""

from typing import Any

import pytest
from django.test import Client
from rest_framework.test import APIClient

from accounts.models import User
from notes.models import Note
from tests.assertions import assert_error

pytestmark = pytest.mark.django_db


def test_create_read_and_list(api: APIClient) -> None:
    created = api.post("/v1/notes", {"title": " First ", "body": "Body"})
    assert created.status_code == 201
    note = created.json()
    assert note["title"] == "First"
    assert note["body"] == "Body"
    assert set(note) == {"id", "title", "body", "createdAt"}
    assert isinstance(note["id"], str)
    assert note["createdAt"].endswith("Z")
    assert created["Location"] == f"/v1/notes/{note['id']}"
    assert created["Cache-Control"] == "no-store"
    assert api.get(created["Location"]).json() == note
    assert api.get("/v1/notes").json() == {"items": [note]}


def test_list_pages_newest_first_with_a_cursor(api: APIClient) -> None:
    first = api.post("/v1/notes", {"title": "First"}).json()
    second = api.post("/v1/notes", {"title": "Second"}).json()
    page = api.get("/v1/notes", {"limit": 1}).json()
    assert page["items"] == [second]
    rest = api.get("/v1/notes", {"limit": 1, "cursor": page["nextCursor"]}).json()
    assert rest == {"items": [first]}


def test_body_is_optional(api: APIClient) -> None:
    assert api.post("/v1/notes", {"title": "Only a title"}).json()["body"] == ""


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"title": ""},
        {"title": " "},
        {"title": "x" * 201},
        {"title": "ok", "body": "x" * 10_001},
        {"title": "ok", "extra": True},
        {"title": "ok", "createdAt": "2020-01-01T00:00:00Z", "id": "7"},
        ["not", "an", "object"],
    ],
)
def test_invalid_bodies_are_400(api: APIClient, payload: Any) -> None:
    assert_error(api.post("/v1/notes", payload, format="json"), "BadInput")
    assert not Note.objects.exists()


def test_malformed_json_is_400(api: APIClient) -> None:
    response = api.post("/v1/notes", "{", content_type="application/json")
    assert_error(response, "BadInput")


@pytest.mark.parametrize("content_type", ["text/plain", "application/x-www-form-urlencoded"])
def test_non_json_bodies_are_415(api: APIClient, content_type: str) -> None:
    response = api.post("/v1/notes", "title=ok", content_type=content_type)
    assert_error(response, "UnsupportedMediaType")


def test_html_only_clients_get_406(api: APIClient) -> None:
    assert_error(api.get("/v1/notes", HTTP_ACCEPT="text/html"), "NotAcceptable")


@pytest.mark.parametrize(
    ("path", "tag"),
    [
        ("/v1/notes/999", "NotFound"),
        ("/v1/notes/missing", "NotFound"),
        ("/v1/notes/", "NotFound"),
        ("/v1/notes?limit=0", "BadInput"),
        ("/v1/notes?limit=101", "BadInput"),
        ("/v1/notes?limit=ten", "BadInput"),
        ("/v1/notes?cursor=!", "BadInput"),
        ("/v1/notes?cursor=bm9wZQ==", "BadInput"),
        ("/v1/notes?cursor=%FF", "BadInput"),
        ("/v1/notes?surprise=yes", "BadInput"),
        ("/v1/notes/1?limit=1", "BadInput"),
    ],
)
def test_request_failures(api: APIClient, path: str, tag: str) -> None:
    Note.objects.create(title="Exists")
    assert_error(api.get(path), tag)


@pytest.mark.parametrize(
    ("method", "path", "allowed"),
    [
        ("delete", "/v1/notes", {"GET", "POST", "HEAD", "OPTIONS"}),
        ("put", "/v1/notes/1", {"GET", "HEAD", "OPTIONS"}),
    ],
)
def test_wrong_methods_are_405_with_allow(
    api: APIClient, method: str, path: str, allowed: set[str]
) -> None:
    Note.objects.create(title="Exists")
    response = getattr(api, method)(path)
    assert_error(response, "MethodNotAllowed")
    assert {name.strip() for name in response["Allow"].split(",")} == allowed


def test_admin_manages_notes(client: Client) -> None:
    admin_user = User.objects.create_superuser("admin", "admin@example.com", "pw-for-tests")
    note = Note.objects.create(title="Visible in admin")
    assert client.get("/admin/notes/note/").status_code == 302
    client.force_login(admin_user)
    changelist = client.get("/admin/notes/note/")
    assert changelist.status_code == 200
    assert b"Visible in admin" in changelist.content
    assert client.get(f"/admin/notes/note/{note.pk}/change/").status_code == 200
