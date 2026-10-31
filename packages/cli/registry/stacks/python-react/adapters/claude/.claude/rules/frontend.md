---
paths:
  - "frontend/app/**"
---

# Frontend conventions

- Read API data through generated hooks; handle the shared `ApiError` from the API fetcher. Invalidate queries with orval's query-key helpers.
- Keep React Router in SPA mode: no server `loader` or `action`.
- Put feature components in `components/<feature>/` and route analytics through the analytics module.
- Use the theme tokens in `app/app.css` rather than raw colors and `cva` for variants instead of ad-hoc class branches.
- Extend owned shadcn components in place rather than wrapping them. Prefer utility classes to inline `style`, and give interactive elements accessible names.
- Generated API files are read-only; change backend routes or schemas and run `make generate-api`.

See the project's `AGENTS.md` for commands and the remaining conventions.
