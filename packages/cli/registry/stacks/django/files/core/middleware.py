from __future__ import annotations

import re
from http import HTTPStatus
from time import perf_counter
from typing import TYPE_CHECKING
from uuid import uuid4

import structlog

if TYPE_CHECKING:
    from collections.abc import Callable

    from django.http import HttpRequest, HttpResponseBase

REQUEST_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
QUIET_ROUTES = frozenset({"/healthz"})

logger = structlog.get_logger("request")


class RequestLogMiddleware:
    """Give every request an id, bind it to the log context and log one line per response.

    A valid incoming X-Request-ID is kept, anything else is replaced, and the id is returned
    in the response header. The line names the route pattern, never the path or query values.
    """

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponseBase]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponseBase:
        supplied = request.headers.get("X-Request-ID", "")
        request_id = supplied if REQUEST_ID.fullmatch(supplied) else uuid4().hex
        tokens = structlog.contextvars.bind_contextvars(request_id=request_id)
        started = perf_counter()
        try:
            # Django turns view exceptions into 500 responses inside get_response.
            response = self.get_response(request)
            response["X-Request-ID"] = request_id
            match = request.resolver_match
            route = f"/{match.route}" if match else "<unmatched>"
            if response.status_code >= HTTPStatus.INTERNAL_SERVER_ERROR:
                log = logger.error
            elif route in QUIET_ROUTES:
                log = logger.debug
            else:
                log = logger.info
            log(
                "request",
                method=request.method,
                route=route,
                status=response.status_code,
                duration_ms=round((perf_counter() - started) * 1000, 3),
            )
            return response
        finally:
            structlog.contextvars.reset_contextvars(**tokens)
