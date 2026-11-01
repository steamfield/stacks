"""The database: URL resolution, the engine's lifetime and the readiness probe."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.notes import SqlNotes

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from app.config import Settings

CONNECT_TIMEOUT = 5
READY_TIMEOUT = 2


def database_url(settings: Settings) -> str | None:
    """DATABASE_URL; in development only, the Compose dev database on PORT_DB."""
    if settings.database_url is not None:
        return settings.database_url.get_secret_value()
    if settings.environment == "development":
        return f"postgresql+asyncpg://app:app@localhost:{settings.port_db}/app"
    if settings.environment == "production":
        msg = "DATABASE_URL is required in production"
        raise RuntimeError(msg)
    return None


class Database:
    def __init__(self, url: str) -> None:
        self.engine = create_async_engine(
            url, pool_pre_ping=True, connect_args={"timeout": CONNECT_TIMEOUT}
        )
        self.notes = SqlNotes(async_sessionmaker(self.engine, expire_on_commit=False))

    async def ready(self) -> bool:
        try:
            async with asyncio.timeout(READY_TIMEOUT), self.engine.connect() as connection:
                await connection.execute(text("SELECT 1"))
        except (OSError, TimeoutError, SQLAlchemyError):
            return False
        return True


@asynccontextmanager
async def open_database(settings: Settings) -> AsyncIterator[Database | None]:
    """The app's database for the lifespan, or None when no URL applies (tests)."""
    url = database_url(settings)
    if url is None:
        yield None
        return
    database = Database(url)
    try:
        yield database
    finally:
        await database.engine.dispose()
