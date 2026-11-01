"""The notes routes and readiness on a real database (this file's own clone)."""

from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr

from app.config import Settings
from app.main import create_app
from tests.db.harness import setup_test_database

notes_db = setup_test_database("notes")

CLOSED_PORT_URL = "postgresql+asyncpg://app:app@127.0.0.1:1/app"


async def client_for(url: str) -> AsyncIterator[AsyncClient]:
    app = create_app(Settings(environment="test", log_level="DEBUG", database_url=SecretStr(url)))
    async with (
        app.router.lifespan_context(app),
        AsyncClient(
            transport=ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://test",
        ) as client,
    ):
        yield client


@pytest.fixture
async def client(notes_db: str) -> AsyncIterator[AsyncClient]:
    async for client in client_for(notes_db):
        yield client


@pytest.fixture
async def down_client() -> AsyncIterator[AsyncClient]:
    async for client in client_for(CLOSED_PORT_URL):
        yield client


async def test_create_then_read_back(client: AsyncClient) -> None:
    created = await client.post("/api/v1/notes", json={"title": "db note", "body": "stored"})
    assert created.status_code == 201
    note = created.json()

    read = await client.get(f"/api/v1/notes/{note['id']}")

    assert read.status_code == 200
    assert read.json() == note


async def test_list_pages_in_creation_order(client: AsyncClient) -> None:
    titles = ["page a", "page b", "page c"]
    ids = [
        (await client.post("/api/v1/notes", json={"title": title, "body": ""})).json()["id"]
        for title in titles
    ]

    seen: list[str] = []
    cursor = ""
    while True:
        page = (await client.get("/api/v1/notes", params={"limit": 2, "cursor": cursor})).json()
        seen.extend(item["id"] for item in page["items"])
        cursor = page.get("nextCursor", "")
        if not cursor:
            break

    assert [note_id for note_id in seen if note_id in ids] == ids


async def test_unknown_note_is_404(client: AsyncClient) -> None:
    response = await client.get("/api/v1/notes/missing")

    assert response.status_code == 404


async def test_ready_when_the_database_answers(client: AsyncClient) -> None:
    response = await client.get("/health/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_unreachable_database_is_503_and_liveness_stays_up(
    down_client: AsyncClient,
) -> None:
    ready = await down_client.get("/health/ready")
    write = await down_client.post("/api/v1/notes", json={"title": "lost", "body": ""})
    live = await down_client.get("/health")

    assert ready.status_code == 503
    assert ready.json()["error"]["code"] == "UNAVAILABLE"
    assert write.status_code == 503
    assert live.status_code == 200
