import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.integration


async def test_ready_without_a_database_is_unavailable(client: AsyncClient) -> None:
    # The Docker-free suite has no database, so readiness fails while liveness holds.
    ready = await client.get("/readyz")
    assert ready.status_code == 503
    assert ready.json() == {
        "error": {"tag": "Unavailable", "message": "Service unavailable.", "retryable": True}
    }
    assert ready.headers["cache-control"] == "no-store"
    assert (await client.get("/healthz")).status_code == 200
