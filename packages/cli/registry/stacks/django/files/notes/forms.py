from django import forms

from notes.models import Note


class NoteForm(forms.ModelForm[Note]):
    class Meta:
        model = Note
        fields = ("title", "body")
