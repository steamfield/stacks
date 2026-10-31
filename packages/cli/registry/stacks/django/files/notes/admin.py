from django.contrib import admin

from notes.models import Note


@admin.register(Note)
class NoteAdmin(admin.ModelAdmin[Note]):
    list_display = ("title", "created_at")
    search_fields = ("title",)
