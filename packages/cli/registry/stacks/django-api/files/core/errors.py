"""The one error table and the envelope every API failure is written in.

`api_exception_handler` (REST_FRAMEWORK["EXCEPTION_HANDLER"]) rewrites every DRF exception,
validation and parse errors, 404s and 405s included, into
`{"error": {"tag", "message", "retryable"}}`. `core.views` uses the same envelope for paths no
view handles and for the 500 page. Messages are fixed: input values and exception messages
never reach a response.
"""

from __future__ import annotations

from http import HTTPStatus
from typing import TYPE_CHECKING, Any, NamedTuple

from rest_framework import serializers
from rest_framework.exceptions import APIException
from rest_framework.views import exception_handler

if TYPE_CHECKING:
    from rest_framework.response import Response


class ErrorRow(NamedTuple):
    status: int
    message: str
    retryable: bool = False


ERRORS = {
    "BadInput": ErrorRow(HTTPStatus.BAD_REQUEST, "Invalid request."),
    "Unauthorized": ErrorRow(HTTPStatus.UNAUTHORIZED, "Authentication required."),
    "Forbidden": ErrorRow(HTTPStatus.FORBIDDEN, "Access denied."),
    "NotFound": ErrorRow(HTTPStatus.NOT_FOUND, "Resource not found."),
    "MethodNotAllowed": ErrorRow(HTTPStatus.METHOD_NOT_ALLOWED, "Method not allowed."),
    "NotAcceptable": ErrorRow(HTTPStatus.NOT_ACCEPTABLE, "Responses are JSON."),
    "Conflict": ErrorRow(HTTPStatus.CONFLICT, "Resource conflict."),
    "UnsupportedMediaType": ErrorRow(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "Expected a JSON body."),
    "RateLimited": ErrorRow(HTTPStatus.TOO_MANY_REQUESTS, "Too many requests.", retryable=True),
    "Internal": ErrorRow(HTTPStatus.INTERNAL_SERVER_ERROR, "Internal server error."),
    "Unavailable": ErrorRow(HTTPStatus.SERVICE_UNAVAILABLE, "Service unavailable.", retryable=True),
}
_TAG_BY_STATUS = {row.status: tag for tag, row in ERRORS.items()}


class AppError(APIException):
    """Raise with a tag from ERRORS; the handler writes its status and fixed message."""

    def __init__(self, tag: str) -> None:
        self.tag = tag
        self.status_code = ERRORS[tag].status
        super().__init__(ERRORS[tag].message, code=tag)


class ServiceUnavailable(AppError):
    """A dependency is down; clients may retry."""

    def __init__(self) -> None:
        super().__init__("Unavailable")


def envelope(tag: str) -> dict[str, Any]:
    row = ERRORS[tag]
    return {"error": {"tag": tag, "message": row.message, "retryable": row.retryable}}


def api_exception_handler(exc: Exception, context: dict[str, Any]) -> Response | None:
    """DRF's handler first (Http404 to 404, auth headers, rollback), then the envelope.

    An unexpected exception returns None: Django logs it once through django.request (class and
    frames, no message) and answers with `core.views.server_error`.
    """
    response = exception_handler(exc, context)
    if response is None:
        return None
    tag = exc.tag if isinstance(exc, AppError) else _TAG_BY_STATUS.get(response.status_code)
    if tag is None:
        # A status the table doesn't name: add a row rather than leak an unlisted one.
        tag = "Internal"
        response.status_code = ERRORS[tag].status
    response.data = envelope(tag)
    return response


class PublicErrorSerializer(serializers.Serializer[Any]):
    tag = serializers.ChoiceField(choices=sorted(ERRORS))
    message = serializers.CharField()
    retryable = serializers.BooleanField()


class ErrorEnvelopeSerializer(serializers.Serializer[Any]):
    """The error body in the OpenAPI schema."""

    error = PublicErrorSerializer()
