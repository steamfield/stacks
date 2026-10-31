import base64
import binascii
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol
from uuid import uuid4

from app.errors import AppError, NotFound

MAX_TITLE = 200
MAX_BODY = 10000
MAX_PAGE = 100


@dataclass(frozen=True)
class Note:
    id: str
    title: str
    body: str
    created_at: datetime


class NoteStore(Protocol):
    async def create(self, title: str, body: str) -> Note: ...
    async def get(self, note_id: str) -> Note: ...
    async def list(self, limit: int, cursor: str) -> tuple[list[Note], str | None]: ...


class MemoryNotes:
    def __init__(self) -> None:
        self._notes: dict[str, Note] = {}

    async def create(self, title: str, body: str) -> Note:
        title = title.strip()
        if not title or len(title) > MAX_TITLE or len(body) > MAX_BODY:
            raise AppError("VALIDATION_FAILED")
        note = Note(uuid4().hex, title, body, datetime.now(UTC))
        self._notes[note.id] = note
        return note

    async def get(self, note_id: str) -> Note:
        try:
            return self._notes[note_id]
        except KeyError as exc:
            raise NotFound() from exc

    async def list(self, limit: int, cursor: str) -> tuple[list[Note], str | None]:
        if not 1 <= limit <= MAX_PAGE:
            raise AppError("VALIDATION_FAILED")
        notes = sorted(self._notes.values(), key=lambda note: (note.created_at, note.id))
        start = 0
        if cursor:
            try:
                note_id = base64.b64decode(
                    cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True
                ).decode("ascii")
                start = next(i + 1 for i, note in enumerate(notes) if note.id == note_id)
            except (ValueError, binascii.Error, StopIteration) as exc:
                raise AppError("VALIDATION_FAILED") from exc
        page = notes[start : start + limit]
        next_cursor = None
        if start + limit < len(notes):
            next_cursor = base64.urlsafe_b64encode(page[-1].id.encode()).decode().rstrip("=")
        return page, next_cursor
