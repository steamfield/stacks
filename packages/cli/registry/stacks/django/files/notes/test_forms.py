import pytest

from notes.forms import NoteForm
from notes.models import Note


def test_title_is_required() -> None:
    form = NoteForm(data={"title": "   ", "body": "text"})
    assert not form.is_valid()
    assert form.errors["title"] == ["This field is required."]


def test_title_length_is_limited() -> None:
    form = NoteForm(data={"title": "x" * 201})
    assert not form.is_valid()
    assert "at most 200 characters" in form.errors["title"][0]


@pytest.mark.django_db
def test_valid_form_saves_a_note() -> None:
    note = NoteForm(data={"title": " Groceries ", "body": ""}).save()
    assert Note.objects.get(pk=note.pk).title == "Groceries"
    assert str(note) == "Groceries"
