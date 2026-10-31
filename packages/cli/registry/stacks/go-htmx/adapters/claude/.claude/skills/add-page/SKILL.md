---
name: add-page
description: Add a server-rendered page, or a form that posts with htmx and swaps a partial, to this Go templ app, with its route, view types, error handling and tests. Use when the user asks for a new page, screen, form, partial, fragment or htmx interaction.
---

# Add a page or form

The notes page is the model to copy: `views.NotesPage` and `views.NoteForm` in `internal/views/notes.templ`, the `GET /{$}` and `POST /notes` routes in `internal/web/handler.go`, and their tests in `views_test.go` and `handler_test.go`.

1. Put the data in a domain package (`internal/<name>`) behind a context-aware `Store` interface. Validation returns `apperrors.Validation(map[string]string{"<field>": "<message for the person>"})`; a missing record returns `apperrors.New(apperrors.NotFound, ...)`.
2. Add the view types to `internal/views/models.go` (plain fields, no domain imports) and the component to a `.templ` file there. A full page renders inside `@Layout("<title>")`; a partial is its own component so the page and the htmx response share it. The hook regenerates `_templ.go` on save; run `make generate` if you renamed or deleted a component.
3. Register the route in `NewHandler` with a method pattern (`GET /things/{id}`) inside `endpoint(...)`, so a returned error renders the error page. Convert domain values to view types with a helper beside `viewNote`.
4. For a form: keep `action` and `method` beside `hx-post`, `hx-target` and `hx-swap`. On success, answer htmx with the fragment (200) and a plain post with `http.Redirect(..., http.StatusSeeOther)`. On a validation error, answer 422: htmx gets the form with `HX-Retarget`/`HX-Reswap` set, a plain post gets the whole page. Read the body with `readForm`'s pattern (`MaxBytesReader`, then `ParseForm`).
5. Test the component in `views_test.go` (goquery selectors on the rendered HTML) and the route in `handler_test.go`: the full page, the htmx and plain success paths, the 422 path with its headers and field errors, and a 404 or store failure. Add the page to the integration test when it changes what the binary serves.
6. Run `make generate-check templ-fmt-check fmt-check lint test test-integration`, then commit the `.templ`, `_templ.go` and Go files together.
