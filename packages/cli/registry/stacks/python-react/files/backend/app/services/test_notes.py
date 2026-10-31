import pytest

from app.errors import AppError, NotFound
from app.services.notes import MemoryNotes


async def test_create_read_and_page() -> None:
    store = MemoryNotes()
    first = await store.create("  First  ", "Body")
    second = await store.create("Second", "")
    assert first.title == "First"
    assert await store.get(first.id) == first
    page, cursor = await store.list(1, "")
    assert page == [first]
    assert cursor is not None
    assert await store.list(1, cursor) == ([second], None)
    assert await MemoryNotes().list(20, "") == ([], None)
    with pytest.raises(NotFound):
        await MemoryNotes().get(first.id)


@pytest.mark.parametrize("title,body", [(" ", ""), ("x" * 201, ""), ("ok", "x" * 10001)])
async def test_invalid_notes_are_rejected(title: str, body: str) -> None:
    with pytest.raises(AppError, match="VALIDATION_FAILED"):
        await MemoryNotes().create(title, body)


@pytest.mark.parametrize(
    "limit,cursor", [(0, ""), (101, ""), (20, "!"), (20, "bWlzc2luZw"), (20, "_w")]
)
async def test_invalid_paging_is_rejected(limit: int, cursor: str) -> None:
    with pytest.raises(AppError, match="VALIDATION_FAILED"):
        await MemoryNotes().list(limit, cursor)
