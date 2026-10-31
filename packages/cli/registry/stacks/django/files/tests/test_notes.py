"""The notes pages through Django's test client against a real database."""

import pytest
from django.test import Client
from django.urls import reverse

from accounts.models import User
from notes.models import Note

pytestmark = pytest.mark.django_db


def test_index_lists_notes_newest_first(client: Client) -> None:
    Note.objects.create(title="First")
    Note.objects.create(title="Second")
    response = client.get(reverse("notes:index"))
    assert response.status_code == 200
    html = response.content.decode()
    assert html.index("Second") < html.index("First")


def test_index_shows_an_empty_state(client: Client) -> None:
    assert b"No notes yet." in client.get("/").content


def test_creating_a_note_redirects_and_shows_it(client: Client) -> None:
    response = client.post("/", {"title": "Buy milk", "body": "2 litres"}, follow=True)
    assert response.redirect_chain == [("/", 302)]
    html = response.content.decode()
    assert "Saved Buy milk." in html
    assert "2 litres" in html
    assert Note.objects.get().title == "Buy milk"


def test_invalid_input_rerenders_the_form_with_errors(client: Client) -> None:
    response = client.post("/", {"title": "", "body": "kept"})
    assert response.status_code == 200
    html = response.content.decode()
    assert "This field is required." in html
    assert "kept" in html
    assert not Note.objects.exists()


def test_posts_need_a_csrf_token() -> None:
    client = Client(enforce_csrf_checks=True)
    assert client.post("/", {"title": "Forged"}).status_code == 403
    assert not Note.objects.exists()


def test_other_methods_are_refused(client: Client) -> None:
    assert client.delete("/").status_code == 405


def test_admin_manages_notes(client: Client) -> None:
    admin_user = User.objects.create_superuser("admin", "admin@example.com", "pw-for-tests")
    note = Note.objects.create(title="Visible in admin")
    assert client.get(reverse("admin:notes_note_changelist")).status_code == 302
    client.force_login(admin_user)
    changelist = client.get(reverse("admin:notes_note_changelist"))
    assert changelist.status_code == 200
    assert b"Visible in admin" in changelist.content
    assert client.get(reverse("admin:notes_note_change", args=[note.pk])).status_code == 200
