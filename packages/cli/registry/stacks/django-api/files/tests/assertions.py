from typing import Any, Protocol

from core.errors import ERRORS


class TestResponse(Protocol):
    """What Django's and DRF's test clients both return."""

    status_code: int

    def json(self) -> Any: ...

    def __getitem__(self, header: str) -> str: ...


def assert_error(response: TestResponse, tag: str) -> None:
    """The response is the shared envelope for `tag`, with its status and the default headers."""
    row = ERRORS[tag]
    assert response.status_code == row.status
    assert response["Content-Type"] == "application/json"
    assert response.json() == {
        "error": {"tag": tag, "message": row.message, "retryable": row.retryable}
    }
    assert response["Cache-Control"] == "no-store"
    assert response["X-Request-ID"]
