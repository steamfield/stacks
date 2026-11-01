---
name: add-endpoint
description: Add an HTTP endpoint or a new resource to this Spring Boot API with its store, error rows and tests. Use when the user asks for a new endpoint, resource, field, query parameter or HTTP method.
---

# Add an endpoint

The notes resource is the worked example: `app.notes` (`Note`, `NewNote`, `NotePage`, `NoteStore`, `InMemoryNoteStore`), `app.web.NotesController`, `NotesControllerTest` and the round trip in `ApiIT`. Follow the same path.

1. **Domain.** A new resource gets its own package beside `app.notes` with a `package-info.java` carrying `@NullMarked`: a record for the resource, a record for each request body with Bean Validation constraints, and a store interface with an in-memory `@Component` implementation. It imports nothing from `app.web`, Spring MVC or servlets (`ArchitectureTest` fails otherwise). A new field on notes goes in `Note`, `NewNote` and `InMemoryNoteStore.create`.
2. **Errors.** Throw `AppException` with an existing `ErrorCode` and a detail for the log. A status the table lacks is a new `ErrorCode` row (status, tag, fixed message, retryable) and a row in `docs/http-api.md`.
3. **Controller.** One `@RestController` per resource in `app.web`, mapped under `/v1/<plural-noun>`, with constructor injection. The body is `@Valid @RequestBody`; a create returns `ResponseEntity.created(<read path>)`. Every query parameter is `@RequestParam(name = "...")` with an explicit name, or `QueryParameterGuard` rejects it; path variables are named for the resource (`{orderId}`).
4. **Test.** In a `@WebMvcTest(<Controller>.class)` test with `@Import` of the in-memory store: a success case and one case per failure (bad body, bad query, unknown id, wrong method), each asserting status, the envelope's `tag` and any header. Unit-test the store's validation and paging, and add one round trip to an `*IT` class.
5. Update `docs/http-api.md`, then run `make fmt compile test test-integration`.
