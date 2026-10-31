from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from pydantic.alias_generators import to_camel

from app.services.notes import MAX_BODY, MAX_PAGE, MAX_TITLE


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
        extra="forbid",
    )


class Health(ApiModel):
    status: Literal["ok"]


class EmptyQuery(ApiModel):
    pass


class NoteInput(ApiModel):
    title: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_TITLE),
    ]
    body: str = Field(default="", max_length=MAX_BODY)


class Note(ApiModel):
    id: str
    title: str
    body: str
    created_at: datetime


class Page(ApiModel):
    items: list[Note]
    next_cursor: str | None = None


class ListQuery(ApiModel):
    limit: int = Field(default=20, ge=1, le=MAX_PAGE)
    cursor: str = ""
