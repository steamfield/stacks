"""A URLconf with a view that raises, so tests can render the real 500 page."""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.urls import include, path

if TYPE_CHECKING:
    from django.http import HttpRequest, HttpResponse


def explode(request: HttpRequest) -> HttpResponse:
    message = "boom"
    raise RuntimeError(message)


urlpatterns = [
    path("explode", explode),
    path("", include("config.urls")),
]
