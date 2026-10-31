from __future__ import annotations

from typing import TYPE_CHECKING

from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_safe

if TYPE_CHECKING:
    from django.http import HttpRequest


@never_cache
@require_safe
def healthz(request: HttpRequest) -> JsonResponse:  # noqa: ARG001 - Django passes the request.
    """Liveness: the process answers. It touches no database, so a slow DB never fails it."""
    return JsonResponse({"status": "ok"})
