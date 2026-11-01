---
name: add-endpoint
description: Add an HTTP endpoint or a new resource to this Quarkus API with its store, error rows and tests. Use when the user asks for a new endpoint, resource, field, query parameter or HTTP method.
---

# Add an endpoint

The notes resource is the worked example: `app.notes` (`Note`, `NewNote`, `NotePage`, `NoteStore`, `InMemoryNoteStore`), `app.web.NotesResource`, `NotesResourceTest` and the round trip in `ApiIT`. Follow the same path.

1. **Domain.** A new resource gets its own package beside `app.notes` with a `package-info.java` carrying `@NullMarked`: a record for the resource, a record for each request body with Bean Validation constraints, and a store interface with an in-memory `@ApplicationScoped` implementation. It imports nothing from `app.web`, `jakarta.ws.rs`, RESTEasy or Vert.x (`ArchitectureTest` fails otherwise). A new field on notes goes in `Note`, `NewNote` and `InMemoryNoteStore.create`.
2. **Errors.** Throw `AppException` with an existing `ErrorCode` and a detail for the log. A status the table lacks is a new `ErrorCode` row (status, tag, fixed message, retryable) and a row in `docs/http-api.md`. `ErrorMappers` already turns it into the envelope; don't add a mapper per resource.
3. **Resource.** One class per resource in `app.web`, `@Path("/v1/<plural-noun>")` and `@Produces(MediaType.APPLICATION_JSON)`, with constructor injection. The body is `@Valid @NotNull`; a create returns `RestResponse.ResponseBuilder.created(<read path>)`. Every query parameter is `@QueryParam("<name>")`, read as a `@Nullable String` and parsed in the resource, or `RequestFilters` rejects it as undeclared; path parameters are named for the resource (`{orderId}`).
4. **Test.** In a `@QuarkusTest` class with RestAssured: a success case and one case per failure (bad body, bad query, unknown id, wrong method), each asserting status, the envelope's `tag` and any header with AssertJ. The store is shared across the class, so never assume it is empty. Unit-test the store's validation and paging, and add one round trip to an `*IT` class.
5. Update `docs/http-api.md`, then run `make fmt compile test test-integration`.
