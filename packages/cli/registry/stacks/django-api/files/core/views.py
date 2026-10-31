"""The health view and the JSON pages Django falls back to outside DRF's views.

config/urls.py sets these as handler400, handler403, handler404 and handler500, so a path no
view matches, a disallowed host and an unexpected exception answer with the same envelope as
the API instead of an HTML page. Django uses them only with DEBUG off.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.http import JsonResponse
from django.views.decorators.http import require_safe

from core.errors import ERRORS, envelope

if TYPE_CHECKING:
    from django.http import HttpRequest


@require_safe
def healthz(request: HttpRequest) -> JsonResponse:  # noqa: ARG001 - Django passes the request.
    """Liveness: the process answers. It touches no database, so a slow DB never fails it."""
    return JsonResponse({"status": "ok"})


def _error(tag: str) -> JsonResponse:
    return JsonResponse(envelope(tag), status=ERRORS[tag].status)


def bad_request(request: HttpRequest, exception: Exception) -> JsonResponse:  # noqa: ARG001
    return _error("BadInput")


def permission_denied(request: HttpRequest, exception: Exception) -> JsonResponse:  # noqa: ARG001
    return _error("Forbidden")


def not_found(request: HttpRequest, exception: Exception) -> JsonResponse:  # noqa: ARG001
    return _error("NotFound")


def server_error(request: HttpRequest) -> JsonResponse:  # noqa: ARG001
    return _error("Internal")
