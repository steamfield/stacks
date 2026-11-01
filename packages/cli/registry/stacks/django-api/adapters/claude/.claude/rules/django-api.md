---
paths:
  - "accounts/**"
  - "config/**"
  - "core/**"
  - "notes/**"
  - "tests/**"
---

# Django REST API conventions

- Each resource is an app shaped like `notes/`: model, admin, `serializers.py`, `views.py`, `urls.py` (a `SimpleRouter` without trailing slashes or regex paths), unit tests beside the code and API tests in `tests/`. Mount it under `v1/` in `config/urls.py`. Cross-cutting code stays in `core/`.
- Serializers subclass `core.api.ResourceSerializer`: explicit `fields`, camelCase wire names through `source=`, validation in `validate_<field>` or `validate`. Ids go out as strings.
- Viewsets subclass `core.api.ResourceViewSet` and mix in only the actions the resource supports. Keep views thin: no business logic in serializer `save()` beyond persistence; put it in a function the view calls. Name the lookup for the resource (`lookup_url_kwarg = "noteId"`).
- Errors: raise DRF exceptions or `core.errors.AppError("<tag>")`. Never return an error `Response` by hand or catch `Exception` in a view; `core.errors.api_exception_handler` writes the envelope. A new status needs an `ERRORS` row.
- After any serializer, view, route or `extend_schema` change, run `make openapi` and commit `openapi.json` in the same change; never edit it by hand (the guard hook refuses). A schema warning is a failure: annotate, don't drop `--fail-on-warn`.
- Every model change ships the migration `make makemigrations` writes, in the same change. Never hand-write or edit a committed migration (the guard hook refuses). Point foreign keys at `settings.AUTH_USER_MODEL`.
- Settings come from `config/env.py::load`. A new setting gets an `Env` field with a validated default, a `VARIABLES` entry, a case in `config/test_env.py` and a line in `.env.example`; nothing else reads `os.environ`.
- List querysets use `select_related`/`prefetch_related` for relations the serializer reads. Every list is paginated by `CursorPage`.
- Log with `structlog.get_logger(__name__)` and key-value fields; never log request bodies, passwords or tokens.
- API tests use `APIClient` and `tests.assertions.assert_error` for every failure case.

See the project's `AGENTS.md` for commands and the remaining conventions.
