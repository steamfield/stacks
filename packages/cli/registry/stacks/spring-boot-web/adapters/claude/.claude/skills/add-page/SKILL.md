---
name: add-page
description: Add a page, a form or a partial update to this Spring Boot web app with its template, validation, error rows and tests. Use when the user asks for a new page, screen, form, field, list, htmx interaction or route.
---

# Add a page

The notes pages are the worked example: `app.notes` (`Note`, `NoteForm`, `NoteStore`, `InMemoryNoteStore`), `app.web.NotesController`, `templates/notes/index.html` and `show.html`, `NotesControllerTest` and the browser flow in `WebIT`. Follow the same path; `docs/web.md` has the rules.

1. **Domain.** A new resource gets its own package beside `app.notes` with a `package-info.java` carrying `@NullMarked`: a record for the resource, a form bean with getters, setters and Bean Validation constraints whose `message` is the text the page shows, and a store interface with an in-memory `@Component`. It imports nothing from `app.web`, Spring MVC, Spring Security, Thymeleaf or servlets (`ArchitectureTest` fails otherwise). A new field on notes goes in `Note`, `NoteForm`, `InMemoryNoteStore.create` and the templates.
2. **Controller.** One `@Controller` per resource in `app.web`, constructor injection, returning view names. A form post takes `@Valid @ModelAttribute("<name>") <Form> form, BindingResult result` and the optional `HX-Request` header: errors re-render (fragment for htmx, whole page otherwise, status 200); success answers htmx with the fragment and a plain post with `redirect:` plus a flash attribute. A missing record throws `AppException(ErrorCode.NOT_FOUND, ...)`; a status the table lacks is a new `ErrorCode` row and a row in `docs/web.md`.
3. **Template.** `templates/<resource>/<page>.html`, replacing its `<html>` with `~{layout :: page(~{::title}, ~{::main})}`. Forms use `th:action` and `method="post"` (the CSRF field comes with them), `th:object`, `th:field` and `th:errors`; a partial update adds `th:hx-post`, `hx-target` and `hx-swap` on the form and a `th:fragment` around the swapped part.
4. **Test.** In a `@WebMvcTest(<Controller>.class)` test importing the in-memory store and `SecurityConfig`, render every new template and read it with jsoup: the GET, a valid and an invalid post with and without `HX-Request` (posts use `.with(csrf())`), a refused post without the token, and any miss. Add the browser flow to an `*IT` with HtmlUnit when the page has a form.
5. Run `make fmt compile test test-integration`.
