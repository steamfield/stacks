---
name: add-model
description: Add a Django model (in an existing app or a new one) with its migration, admin, form, views, templates and tests. Use when the user asks for a new kind of record, a new page that lists or edits records, or a new app.
---

# Add a model

`notes/` is the model to copy: `models.py`, `admin.py`, `forms.py`, `views.py`, `urls.py`, `templates/notes/index.html`, `test_forms.py` and `tests/test_notes.py`. Read them first.

1. New app only: `uv run python manage.py startapp <app>`, then delete the generated `tests.py` and `views.py` stubs you won't use, add `"<app>"` to `INSTALLED_APPS` in `config/settings.py`, and include `<app>.urls` in `config/urls.py`. Add the app to the `paths:` list in `.claude/rules/django.md` and to `known-first-party` in `pyproject.toml`.
2. Write the model: fields, `class Meta` with an `ordering` that ends in a unique field, then `__str__`. A link to users is `models.ForeignKey(settings.AUTH_USER_MODEL, ...)`.
3. `make makemigrations`, read the generated file, then `make check-migrations`. Never write the migration by hand.
4. Register it in the app's `admin.py` with `list_display` and `search_fields`.
5. A `ModelForm[<Model>]` in `forms.py` listing `fields` explicitly; extra rules go in `clean_<field>` or `clean`.
6. A view per page in `views.py` that follows `notes.views.index`: allowed methods declared, redirect after a successful POST, bound form re-rendered on errors, querysets sliced and using `select_related`/`prefetch_related` for relations the template reads. Add its `path()` with a name and an `app_name` namespace.
7. Templates under `<app>/templates/<app>/`, extending `base.html`, with `{% csrf_token %}` in every POST form.
8. Tests: form rules beside the code (`<app>/test_forms.py`), and pages through the test client in `tests/test_<app>.py` with `pytestmark = pytest.mark.django_db`: list, create and redirect, each validation error, CSRF, and the admin changelist.
9. `make format`, then `make lint typecheck coverage check-migrations`.
