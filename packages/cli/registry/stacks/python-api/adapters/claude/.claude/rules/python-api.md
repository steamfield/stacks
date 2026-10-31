---
paths:
  - "app/**"
  - "scripts/**"
---

# API conventions

- Build through `app/main.py::create_app()`; mount routers only in that factory. Imports must not connect to services or write files.
- Raise `AppError` subclasses instead of `HTTPException`; handlers own the shared error envelope. A dependency that is down raises `ServiceUnavailable` (503).
- Use the shared `ApiModel` base for wire models and a `response_model` on every route.
- Operation ids derive from the tag and function name. Renaming a route function changes the published spec.
- Keep FastAPI out of `app/services/`; services contain plain business logic.
- After any route or model change, run `make openapi` and commit `openapi.json` with the change. Never edit it by hand.

See the project's `AGENTS.md` for commands and the remaining conventions.
