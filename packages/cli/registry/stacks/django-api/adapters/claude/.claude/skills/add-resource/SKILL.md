---
name: add-resource
description: Add a REST resource to this Django REST Framework API (model, migration, admin, serializer, viewset, routes, OpenAPI schema and tests). Use when the user asks for a new endpoint, a new kind of record the API stores, or a new app.
---

# Add a resource

`notes/` is the shape to copy: `models.py`, `admin.py`, `serializers.py`, `views.py`, `urls.py`, `test_serializers.py` and `tests/test_notes_api.py`. Read them first.

1. New app: `uv run python manage.py startapp <app>`, delete the generated `tests.py` and `views.py` stub contents you won't use, add `"<app>"` to `INSTALLED_APPS`, add the app to the `paths:` list in `.claude/rules/django-api.md` and to `known-first-party` in `pyproject.toml`.
2. Model: fields, a `created_at = DateTimeField(auto_now_add=True)` (`CursorPage` orders by it, then id), `Meta.ordering`, `__str__`. Users are `ForeignKey(settings.AUTH_USER_MODEL, ...)`.
3. `make makemigrations`, read the generated file, then `make check-migrations`. Never write the migration by hand.
4. Register it in `admin.py` with `list_display` and `search_fields`.
5. Serializer: subclass `ResourceSerializer[<Model>]`, list `fields`, camelCase wire names with `source=`, `id` as a read-only `CharField`, limits in `extra_kwargs`, rules in `validate_<field>`.
6. Viewset: subclass `ResourceViewSet[<Model>]` with only the mixins it supports, `queryset`, `serializer_class`, `lookup_url_kwarg = "<resource>Id"`, `lookup_value_converter = "str"`, `get_success_headers` returning `Location`, and an `extend_schema_view` summary per action. Filters go in `filter_params` and `get_queryset`.
7. Routes: in `<app>/urls.py`, a `SimpleRouter(trailing_slash=False, use_regex_path=False)` registering the plural kebab-case noun; include it under `v1/` in `config/urls.py`.
8. `make openapi` and read the `openapi.json` diff: paths, parameter and schema names are public.
9. Tests: serializer rules beside the code, and `tests/test_<app>_api.py` with `pytestmark = pytest.mark.django_db`: create and read back through `Location`, list paging, each validation error, 404, a wrong method's 405 and `Allow`, each through `assert_error`.
10. `make format`, then `make lint typecheck coverage check-migrations check-openapi`.
