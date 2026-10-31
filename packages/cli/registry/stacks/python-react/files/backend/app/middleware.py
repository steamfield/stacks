from __future__ import annotations

import re
from http import HTTPStatus
from time import perf_counter
from typing import TYPE_CHECKING
from uuid import uuid4

import structlog
from starlette.datastructures import Headers, MutableHeaders
from starlette.requests import Request

from app.error_handlers import internal_error

if TYPE_CHECKING:
    from starlette.types import ASGIApp, Message, Receive, Scope, Send


class RequestMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        supplied = Headers(scope=scope).get("x-request-id", "")
        request_id = supplied if re.fullmatch(r"[A-Za-z0-9_-]{1,64}", supplied) else uuid4().hex
        scope.setdefault("state", {})["request_id"] = request_id
        tokens = structlog.contextvars.bind_contextvars(request_id=request_id)
        started = perf_counter()
        status = 500
        sent = False

        async def send_response(message: Message) -> None:
            nonlocal status, sent
            if message["type"] == "http.response.start":
                status, sent = message["status"], True
                headers = MutableHeaders(scope=message)
                headers["X-Request-ID"] = request_id
                if status != HTTPStatus.NOT_MODIFIED and "cache-control" not in headers:
                    headers["Cache-Control"] = "no-store"
            await send(message)

        try:
            try:
                await self.app(scope, receive, send_response)
            except Exception as exc:
                if sent:
                    raise
                response = await internal_error(Request(scope), exc)
                await response(scope, receive, send_response)
        finally:
            route = getattr(scope.get("route"), "path", "<unmatched>")
            logger = structlog.get_logger()
            log = logger.error if status >= HTTPStatus.INTERNAL_SERVER_ERROR else logger.info
            if route == "/health":
                log = logger.debug
            try:
                log(
                    "request",
                    method=scope["method"],
                    route=route,
                    status=status,
                    duration_ms=round((perf_counter() - started) * 1000, 3),
                    error=scope.get("state", {}).get("failure"),
                )
            finally:
                structlog.contextvars.reset_contextvars(**tokens)
