from __future__ import annotations

import traceback
from typing import TYPE_CHECKING

from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import iter_route_contexts
from pydantic import BaseModel
from starlette.exceptions import HTTPException
from starlette.routing import Match

from app.errors import ERRORS, AppError

if TYPE_CHECKING:
    from collections.abc import Mapping

    from fastapi import FastAPI, Request


class PublicError(BaseModel):
    tag: str
    message: str
    retryable: bool


class ErrorEnvelope(BaseModel):
    error: PublicError


def error_response(tag: str, headers: Mapping[str, str] | None = None) -> JSONResponse:
    row = ERRORS[tag]
    return JSONResponse(
        status_code=row.status,
        content=ErrorEnvelope(
            error=PublicError(tag=tag, message=row.message, retryable=row.retryable)
        ).model_dump(),
        headers=headers,
    )


async def app_error(_request: Request, exc: Exception) -> JSONResponse:
    if isinstance(exc, AppError) and exc.tag in ERRORS:
        return error_response(exc.tag)
    return await internal_error(_request, exc)


async def validation_error(_request: Request, _exc: Exception) -> JSONResponse:
    return error_response("BadInput")


async def http_error(request: Request, exc: Exception) -> JSONResponse:
    if isinstance(exc, HTTPException):
        tag = next(
            (tag for tag, row in ERRORS.items() if row.status == exc.status_code),
            "Internal",
        )
        headers = dict(exc.headers or {})
        if tag == "MethodNotAllowed":
            # The router's first partial match omits other routes sharing this path.
            methods = {
                method
                for route in iter_route_contexts(request.app.routes)
                if route.matches(request.scope)[0] == Match.PARTIAL
                for method in (route.methods or ())
            }
            if methods:
                headers["Allow"] = ", ".join(sorted(methods))
        return error_response(tag, headers)
    return await internal_error(request, exc)


async def internal_error(request: Request, exc: Exception) -> JSONResponse:
    # Exception messages and locals may contain credentials or request bodies.
    request.state.failure = {
        "class": type(exc).__name__,
        "frames": [
            {"file": frame.filename, "line": frame.lineno, "function": frame.name}
            for frame in traceback.extract_tb(exc.__traceback__)
        ],
    }
    return error_response("Internal")


def register_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, app_error)
    app.add_exception_handler(RequestValidationError, validation_error)
    app.add_exception_handler(HTTPException, http_error)
    app.add_exception_handler(Exception, internal_error)


ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    row.status: {"model": ErrorEnvelope} for row in ERRORS.values()
}
# FastAPI otherwise adds its stock 422 schema although validation is mapped to BadInput.
ERROR_RESPONSES["default"] = {"model": ErrorEnvelope}
