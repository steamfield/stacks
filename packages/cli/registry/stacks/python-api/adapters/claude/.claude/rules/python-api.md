---
paths:
  - "app/**"
  - "scripts/**"
---

# API conventions

- Build through `app/main.py::create_app()`; mount routers only in that factory. Imports must not connect to services or write files.
- Raise `AppError` subclasses instead of `HTTPException`; handlers own the shared error envelope. A dependency that is down raises `ServiceUnavailable` (503).
- Use the shared `ApiModel` base for wire models and a `response_model` on every route.
- Every resource route sets `operation_id` in camelCase verb-noun form, as the notes routes do (`listNotes`, `getNote`, `createNote`). Clients generated from `openapi.json` name their functions after it, so changing an id breaks every caller. Health routes keep the factory's `<tag>_<function>` fallback.
- Keep FastAPI out of `app/services/`; services contain plain business logic.
- After any route or model change, run `make openapi` and commit `openapi.json` with the change. Never edit it by hand.

See the project's `AGENTS.md` for commands and the remaining conventions.
