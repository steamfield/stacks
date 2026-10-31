from __future__ import annotations

from typing import TYPE_CHECKING

from app.api import health, notes

if TYPE_CHECKING:
    from fastapi import FastAPI


def register_routers(app: FastAPI) -> None:
    app.include_router(health.router)
    app.include_router(notes.router)
