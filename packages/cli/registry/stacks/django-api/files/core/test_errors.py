import pytest
from django.http import Http404
from rest_framework import exceptions

from core.errors import ERRORS, AppError, ServiceUnavailable, api_exception_handler, envelope


def test_every_row_has_a_distinct_status() -> None:
    statuses = [row.status for row in ERRORS.values()]
    assert len(statuses) == len(set(statuses))


@pytest.mark.parametrize(
    ("exc", "tag"),
    [
        (exceptions.ValidationError({"title": ["secret input"]}), "BadInput"),
        (exceptions.ParseError(), "BadInput"),
        (exceptions.NotAuthenticated(), "Unauthorized"),
        (exceptions.PermissionDenied(), "Forbidden"),
        (Http404("secret path"), "NotFound"),
        (exceptions.MethodNotAllowed("DELETE"), "MethodNotAllowed"),
        (exceptions.Throttled(wait=3), "RateLimited"),
        (AppError("Conflict"), "Conflict"),
        (ServiceUnavailable(), "Unavailable"),
    ],
)
def test_exceptions_map_to_the_envelope(exc: Exception, tag: str) -> None:
    response = api_exception_handler(exc, {})
    assert response is not None
    assert response.status_code == ERRORS[tag].status
    assert response.data == envelope(tag)
    assert "secret" not in str(response.data)


def test_retry_after_survives_on_throttling() -> None:
    response = api_exception_handler(exceptions.Throttled(wait=3), {})
    assert response is not None
    assert response["Retry-After"] == "3"


def test_unlisted_statuses_become_internal() -> None:
    class Teapot(exceptions.APIException):
        status_code = 418

    response = api_exception_handler(Teapot(), {})
    assert response is not None
    assert response.status_code == 500
    assert response.data == envelope("Internal")


def test_unexpected_exceptions_are_left_to_django() -> None:
    assert api_exception_handler(RuntimeError("boom"), {}) is None
