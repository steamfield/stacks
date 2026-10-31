from __future__ import annotations

from typing import Any

from django.urls import reverse
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import mixins

from core.api import ResourceViewSet
from notes.models import Note
from notes.serializers import NoteSerializer


@extend_schema_view(
    list=extend_schema(summary="List notes, newest first"),
    create=extend_schema(summary="Create a note"),
    retrieve=extend_schema(summary="Read a note"),
)
class NoteViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    ResourceViewSet[Note],
):
    # /v1/notes: list and create; /v1/notes/{noteId}: read. Other methods are a 405.
    # (A docstring here would become every operation's description in openapi.json.)

    queryset = Note.objects.all()
    serializer_class = NoteSerializer
    lookup_url_kwarg = "noteId"
    # Ids are opaque strings on the wire; one that isn't a stored id is a 404.
    lookup_value_converter = "str"

    def get_success_headers(self, data: Any) -> dict[str, str]:
        return {"Location": reverse("note-detail", kwargs={"noteId": data["id"]})}
