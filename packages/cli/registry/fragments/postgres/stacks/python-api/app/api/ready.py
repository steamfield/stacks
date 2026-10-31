from typing import TYPE_CHECKING, Annotated, cast

from fastapi import APIRouter, Query, Request

from app.error_handlers import ERROR_RESPONSES
from app.errors import ServiceUnavailable
from app.schemas import EmptyQuery, Health

if TYPE_CHECKING:
    from app.db import Database

router = APIRouter(tags=["health"], responses=ERROR_RESPONSES)


@router.get("/readyz", response_model=Health, summary="Check database readiness")
async def ready(request: Request, _query: Annotated[EmptyQuery, Query()]) -> Health:
    database = cast("Database | None", request.app.state.database)
    if database is None or not await database.ready():
        raise ServiceUnavailable()
    return Health()
