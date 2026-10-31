from collections.abc import Callable, Coroutine
from typing import Annotated, Any, cast

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.routing import APIRoute

from app.error_handlers import ERROR_RESPONSES
from app.errors import AppError
from app.schemas import EmptyQuery, ListQuery, Note, NoteInput, Page
from app.services.notes import NoteStore


class JsonRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def handle(request: Request) -> Response:
            # Check before FastAPI decodes JSON, including media types ending in +json.
            if self.body_field is not None:
                media_type = (
                    request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
                )
                if media_type != "application/json":
                    raise AppError("UNSUPPORTED_MEDIA_TYPE")
            return await handler(request)

        return handle


router = APIRouter(
    prefix="/api/v1/notes", tags=["notes"], responses=ERROR_RESPONSES, route_class=JsonRoute
)


async def get_note_store(request: Request) -> NoteStore:
    return cast("NoteStore", request.app.state.note_store)


Store = Annotated[NoteStore, Depends(get_note_store)]


@router.post(
    "",
    response_model=Note,
    status_code=201,
    summary="Create a note",
)
async def create(
    payload: NoteInput, response: Response, store: Store, _query: Annotated[EmptyQuery, Query()]
) -> Note:
    note = Note.model_validate(await store.create(payload.title, payload.body))
    response.headers["Location"] = f"/api/v1/notes/{note.id}"
    return note


@router.get("/{noteId}", response_model=Note, summary="Read a note")
async def get(noteId: str, store: Store, _query: Annotated[EmptyQuery, Query()]) -> Note:
    return Note.model_validate(await store.get(noteId))


@router.get("", response_model=Page, response_model_exclude_none=True, summary="List notes")
async def list_notes(query: Annotated[ListQuery, Query()], store: Store) -> Page:
    notes, cursor = await store.list(query.limit, query.cursor)
    return Page(items=[Note.model_validate(note) for note in notes], next_cursor=cursor)
