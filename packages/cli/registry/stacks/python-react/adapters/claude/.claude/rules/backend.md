---
paths:
  - "backend/**"
---

# Backend conventions

- Build through `create_app()`; mount routers only through `register_routers()` in `app/routers.py`. Imports must not connect to services or write files.
- Raise `AppError` subclasses instead of `HTTPException`; handlers own the shared error envelope.
- Notes is the example resource: copy `app/api/notes.py`, `app/services/notes.py` and their tests for a new one. Import `JsonRoute` (415 for non-JSON bodies) from `app.api.notes` for routers that accept JSON.
- Use the shared `ApiModel` base for wire models and a `response_model` on every route. Model class names become OpenAPI schema and generated type names, global across the app. Reuse only `ApiModel` and `EmptyQuery` (routes without query parameters); name a resource's own models after it (`ProjectInput`, `ProjectPage`). Notes' unprefixed `Page` and `ListQuery` belong to Notes.
- Operation ids derive from the tag and function name. Renaming a route function renames its generated frontend hook.
- Keep FastAPI out of `app/services/`; services contain plain business logic.
- After any route or schema change, run `make generate-api` and commit the spec and generated client together. Do not edit generated files by hand.

See the project's `AGENTS.md` for commands and the remaining conventions.
