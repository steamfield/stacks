from __future__ import annotations

from typing import TYPE_CHECKING

import structlog
from django.contrib import messages
from django.shortcuts import redirect, render
from django.views.decorators.http import require_http_methods

from notes.forms import NoteForm
from notes.models import Note

if TYPE_CHECKING:
    from django.http import HttpRequest, HttpResponse

PAGE_SIZE = 50

logger = structlog.get_logger(__name__)


@require_http_methods(["GET", "HEAD", "POST"])
def index(request: HttpRequest) -> HttpResponse:
    """List the newest notes with the add form; a valid POST saves and redirects (PRG)."""
    if request.method == "POST":
        form = NoteForm(request.POST)
        if form.is_valid():
            note = form.save()
            logger.info("note_created", note_id=note.pk)
            messages.success(request, f"Saved {note.title}.")
            return redirect("notes:index")
    else:
        form = NoteForm()
    notes = Note.objects.all()[:PAGE_SIZE]
    return render(request, "notes/index.html", {"form": form, "notes": notes})
