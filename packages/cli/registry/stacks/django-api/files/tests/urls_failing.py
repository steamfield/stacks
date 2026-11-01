"""A URLconf with an API view that raises, so tests can exercise the real 500 path."""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.urls import include, path
from rest_framework.decorators import api_view

if TYPE_CHECKING:
    from rest_framework.request import Request
    from rest_framework.response import Response


@api_view(["GET"])
def explode(request: Request) -> Response:
    message = "secret-sentinel"
    raise RuntimeError(message)


urlpatterns = [
    path("v1/explode", explode),
    path("", include("config.urls")),
]

# Django reads the error handlers from the root URLconf, so this one names them too.
handler404 = "core.views.not_found"
handler500 = "core.views.server_error"
