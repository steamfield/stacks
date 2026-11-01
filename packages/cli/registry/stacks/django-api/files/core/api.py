"""Bases every resource builds on: strict input, cursor pages and the documented error body."""

from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, ClassVar, TypeVar
from urllib.parse import parse_qs, urlsplit

from django.db import models
from drf_spectacular.openapi import AutoSchema
from rest_framework import serializers, viewsets
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.pagination import Cursor, CursorPagination
from rest_framework.response import Response

from core.errors import ErrorEnvelopeSerializer

if TYPE_CHECKING:
    from rest_framework.request import Request

_M = TypeVar("_M", bound=models.Model)


class ResourceSerializer(serializers.ModelSerializer[_M]):
    """A model serializer that refuses fields it doesn't declare instead of dropping them."""

    def to_internal_value(self, data: Any) -> Any:
        if isinstance(data, Mapping):
            writable = {name for name, field in self.fields.items() if not field.read_only}
            unknown = set(data) - writable
            if unknown:
                raise ValidationError(
                    {name: ["Unknown or read-only field."] for name in sorted(unknown)}
                )
        return super().to_internal_value(data)


class CursorPage(CursorPagination):
    """`?limit=&cursor=` pages answered as `{"items": [...], "nextCursor": "..."}`.

    Newest first, ties broken by id. A bad limit or cursor is a 400, not a silent default.
    """

    page_size = 20
    max_page_size = 100
    page_size_query_param = "limit"
    cursor_query_param = "cursor"
    ordering = ("-created_at", "-id")

    def get_page_size(self, request: Request) -> int:
        raw = request.query_params.get(self.page_size_query_param)
        if raw is None:
            return self.page_size
        # isascii: isdigit alone accepts digits such as "²" that int() rejects.
        if not (raw.isascii() and raw.isdigit()) or not 1 <= int(raw) <= self.max_page_size:
            raise ValidationError({self.page_size_query_param: ["Out of range."]})
        return int(raw)

    def decode_cursor(self, request: Request) -> Cursor | None:
        invalid = ValidationError({self.cursor_query_param: ["Invalid cursor."]})
        try:
            cursor = super().decode_cursor(request)
        except NotFound as exc:
            raise invalid from exc
        # DRF decodes junk such as "!" to an empty cursor; a real one always carries a position.
        if cursor == Cursor(offset=0, reverse=False, position=None):
            raise invalid
        return cursor

    def get_paginated_response(self, data: Any) -> Response:
        body: dict[str, Any] = {"items": data}
        next_link = self.get_next_link()
        if next_link:
            body["nextCursor"] = parse_qs(urlsplit(next_link).query)[self.cursor_query_param][0]
        return Response(body)

    def get_paginated_response_schema(self, schema: dict[str, Any]) -> dict[str, Any]:
        return {
            "type": "object",
            "required": ["items"],
            "properties": {"items": schema, "nextCursor": {"type": "string"}},
        }


class ResourceViewSet(viewsets.GenericViewSet[_M]):
    """Cursor-paginated, and a query parameter the action doesn't read is a 400.

    `list` reads `limit` and `cursor`; add filter names to `filter_params`.
    """

    pagination_class = CursorPage
    filter_params: ClassVar[frozenset[str]] = frozenset()

    def initial(self, request: Request, *args: Any, **kwargs: Any) -> None:
        super().initial(request, *args, **kwargs)
        allowed = self.filter_params | {"limit", "cursor"} if self.action == "list" else set()
        unknown = set(request.query_params) - allowed
        if unknown:
            raise ValidationError({name: ["Unknown query parameter."] for name in sorted(unknown)})


class ApiSchema(AutoSchema):
    """Every operation documents the error envelope as its default response."""

    def get_response_serializers(self) -> Any:
        responses = super().get_response_serializers()
        if isinstance(responses, dict):
            return {**responses, "default": ErrorEnvelopeSerializer}
        success = "201" if self._is_create_operation() else "200"
        return {success: responses, "default": ErrorEnvelopeSerializer}
