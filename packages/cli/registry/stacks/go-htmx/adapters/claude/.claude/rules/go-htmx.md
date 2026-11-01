---
paths:
  - "**/*.templ"
  - "internal/views/**"
  - "internal/web/**"
  - "static/**"
---

# templ and htmx rules

- Edit `.templ` files, never `*_templ.go`; the hook denies it and regenerates the component after each `.templ` write. Run `make generate` after a rename or delete, then `make generate-check templ-fmt-check`, and commit the `.templ` and `_templ.go` files together.
- Components take the view types in `internal/views/models.go` and never import a domain package or call a store. Handlers in `internal/web` load data, convert it with `viewNote`-style functions and call `render`.
- Every htmx endpoint also works as a plain request: a form keeps `action` and `method` beside `hx-post`, a valid plain post answers 303 to a page, and an invalid one re-renders the whole page with 422. Branch on `isHTMX(r)` only to choose a fragment over a page.
- Validation errors are 422 with the form re-rendered, field messages in `Form.Errors` and the submitted values kept. For htmx, set `HX-Retarget` and `HX-Reswap` so the form replaces itself. Never answer an htmx request with a 3xx; htmx follows it and swaps the result into the target. Use `HX-Redirect` with a 200 for a full navigation.
- Other failures return `internal/errors` values; `renderError` and `errorTable` pick the status and the page text. A cause never reaches the page.
- `HTMXConfig` lists which statuses swap. A new swapping status (409 for a conflict) is added there before the `[45]..` rule, with its test in `views_test.go`.
- The content security policy allows same-origin scripts and styles only: no inline `<script>`, `<style>`, `style=` or `hx-on`. Put CSS in `static/app.css` and behavior in htmx attributes or a file under `static/`.
- templ escapes text and attribute values. Never pass user input through `templ.Raw` or a `templ.SafeURL` built from it.
- Run templ as `go tool templ` or through make, never a globally installed `templ`.

See the project's `AGENTS.md` for commands and the remaining conventions.
