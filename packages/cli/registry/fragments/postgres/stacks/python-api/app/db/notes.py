"""NoteStore on Postgres, with the same contract as MemoryNotes."""

from __future__ import annotations

import base64
import binascii
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import select, tuple_
from sqlalchemy.exc import InterfaceError, OperationalError

from app.db.models import NoteRow
from app.errors import AppError, NotFound, ServiceUnavailable
from app.services.notes import MAX_BODY, MAX_PAGE, MAX_TITLE, Note

if TYPE_CHECKING:
    from collections.abc import Iterator

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


@contextmanager
def unavailable() -> Iterator[None]:
    """Map a lost or unreachable database to 503, keeping the cause."""
    try:
        yield
    except (OSError, TimeoutError, OperationalError, InterfaceError) as exc:
        raise ServiceUnavailable() from exc


def encode_cursor(note_id: str) -> str:
    return base64.urlsafe_b64encode(note_id.encode()).decode().rstrip("=")


def decode_cursor(cursor: str) -> str:
    try:
        return base64.b64decode(
            cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True
        ).decode("ascii")
    except (ValueError, binascii.Error) as exc:
        raise AppError("BadInput") from exc


def to_note(row: NoteRow) -> Note:
    return Note(row.id, row.title, row.body, row.created_at)


class SqlNotes:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    async def create(self, title: str, body: str) -> Note:
        title = title.strip()
        if not title or len(title) > MAX_TITLE or len(body) > MAX_BODY:
            raise AppError("BadInput")
        row = NoteRow(id=uuid4().hex, title=title, body=body, created_at=datetime.now(UTC))
        with unavailable():
            async with self._sessions.begin() as session:
                session.add(row)
        return to_note(row)

    async def get(self, note_id: str) -> Note:
        with unavailable():
            async with self._sessions() as session:
                row = await session.get(NoteRow, note_id)
        if row is None:
            raise NotFound()
        return to_note(row)

    async def list(self, limit: int, cursor: str) -> tuple[list[Note], str | None]:
        if not 1 <= limit <= MAX_PAGE:
            raise AppError("BadInput")
        query = select(NoteRow).order_by(NoteRow.created_at, NoteRow.id).limit(limit + 1)
        with unavailable():
            async with self._sessions() as session:
                if cursor:
                    anchor = await session.get(NoteRow, decode_cursor(cursor))
                    if anchor is None:
                        raise AppError("BadInput")
                    query = query.where(
                        tuple_(NoteRow.created_at, NoteRow.id)
                        > tuple_(anchor.created_at, anchor.id)
                    )
                rows = list((await session.scalars(query)).all())
        page = rows[:limit]
        next_cursor = encode_cursor(page[-1].id) if len(rows) > limit else None
        return [to_note(row) for row in page], next_cursor
