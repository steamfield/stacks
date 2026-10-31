from __future__ import annotations

from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

from fastapi import FastAPI

from app.api import health, notes
from app.config import Settings, get_settings
from app.error_handlers import register_handlers
from app.logging import configure_logging
from app.middleware import RequestMiddleware
from app.services.notes import MemoryNotes

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from fastapi.routing import APIRoute


def operation_id(route: APIRoute) -> str:
    return f"{route.tags[0]}_{route.name}"


def create_app(settings: Settings | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.settings = settings if settings is not None else get_settings()
        configure_logging(app.state.settings)
        app.state.note_store = MemoryNotes()
        try:
            yield
        finally:
            del app.state.note_store

    app = FastAPI(
        lifespan=lifespan,
        generate_unique_id_function=operation_id,
        redirect_slashes=False,
    )
    register_handlers(app)
    app.add_middleware(RequestMiddleware)
    app.include_router(health.router)
    app.include_router(notes.router)
    return app


app = create_app()
