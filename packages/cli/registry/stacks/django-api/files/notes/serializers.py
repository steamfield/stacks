from rest_framework import serializers

from core.api import ResourceSerializer
from notes.models import Note


class NoteSerializer(ResourceSerializer[Note]):
    """One shape for create, read and list: camelCase on the wire, snake_case in the model."""

    # Ids are opaque strings to clients.
    id = serializers.CharField(read_only=True)
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = Note
        fields = ("id", "title", "body", "createdAt")
        extra_kwargs = {"body": {"max_length": 10_000}}  # noqa: RUF012 - DRF reads it as is.
