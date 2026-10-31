import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.integration


async def test_ready_without_a_database_is_unavailable(client: AsyncClient) -> None:
    # The Docker-free suite has no database, so readiness fails while liveness holds.
    ready = await client.get("/health/ready")
    assert ready.status_code == 503
    error = ready.json()["error"]
    assert error["code"] == "UNAVAILABLE"
    assert error["message"] == "Service unavailable."
    assert ready.headers["cache-control"] == "no-store"
    assert (await client.get("/health")).status_code == 200
