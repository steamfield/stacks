---
paths:
  - "accounts/**"
  - "config/**"
  - "core/**"
  - "notes/**"
  - "templates/**"
  - "tests/**"
---

# Django conventions

- Each feature is an app with its own models, admin, forms, views, urls, `templates/<app>/` and tests. Register it in `INSTALLED_APPS` and include its urls in `config/urls.py`. Cross-cutting code (middleware, health, error pages) stays in `core/`.
- Settings come from `config/env.py::load`. A new setting gets an `Env` field with a validated default, a `VARIABLES` entry, a case in `config/test_env.py` and a line in `.env.example`; nothing else reads `os.environ`.
- Every model change ships the migration `make makemigrations` writes, in the same change. Never hand-write a migration or edit a shipped or committed one (the guard hook refuses); a data migration starts from `makemigrations --empty <app>`. `make check-migrations` fails on a model with no migration.
- Point foreign keys at `settings.AUTH_USER_MODEL`, never at `auth.User` or `accounts.User` directly.
- Validation lives in forms and models, not views. Views stay thin: bind the form, save on `is_valid()`, redirect after a successful POST, re-render with the bound form otherwise.
- When a template loops over a relation, the view's queryset uses `select_related` or `prefetch_related`. Paginate or slice every list.
- Templates escape by default; never mark user input `|safe`. Every POST form carries `{% csrf_token %}`; no `csrf_exempt`.
- Log with `structlog.get_logger(__name__)` and key-value fields; never log request bodies, passwords or tokens. `RequestLogMiddleware` already logs one line per request.
- Use the ORM. Raw SQL needs a comment saying why, and parameters, never string formatting.
- Don't run `migrate` against anything but the local `var/` database.

See the project's `AGENTS.md` for commands and the remaining conventions.
