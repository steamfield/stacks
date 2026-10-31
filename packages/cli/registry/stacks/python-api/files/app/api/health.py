from typing import Annotated

from fastapi import APIRouter, Query

from app.error_handlers import ERROR_RESPONSES
from app.schemas import EmptyQuery, Health

router = APIRouter(tags=["health"], responses=ERROR_RESPONSES)


@router.get("/healthz", response_model=Health, summary="Check process liveness")
async def get(_query: Annotated[EmptyQuery, Query()]) -> Health:
    return Health()
