import { createRoute } from "@hono/zod-openapi";
import { errorResponse, NotFoundError } from "../errors.ts";
import { createRouter } from "../router.ts";
import { Note, NoteInput, NoteListQuery, NotePage, NoteParams } from "../schemas/notes.ts";
import type { NotesStore } from "../services/notes.ts";

const json = <T>(schema: T) => ({ "application/json": { schema } });

const list = createRoute({
  method: "get",
  path: "/v1/notes",
  operationId: "listNotes",
  request: { query: NoteListQuery },
  responses: {
    200: { description: "A page of notes, oldest first", content: json(NotePage) },
    400: errorResponse("Invalid or unknown query parameter"),
  },
});

const get = createRoute({
  method: "get",
  path: "/v1/notes/{id}",
  operationId: "getNote",
  request: { params: NoteParams },
  responses: {
    200: { description: "The note", content: json(Note) },
    400: errorResponse("Malformed id"),
    404: errorResponse("No note with this id"),
  },
});

const create = createRoute({
  method: "post",
  path: "/v1/notes",
  operationId: "createNote",
  request: { body: { content: json(NoteInput), required: true } },
  responses: {
    201: {
      description: "The created note; Location names it",
      headers: { Location: { schema: { type: "string" } } },
      content: json(Note),
    },
    400: errorResponse("Invalid body"),
    413: errorResponse("Body over the size limit"),
    415: errorResponse("Body isn't JSON"),
  },
});

export function notesRoutes(store: NotesStore) {
  return createRouter()
    .openapi(list, async (c) => c.json(await store.list(c.req.valid("query")), 200))
    .openapi(get, async (c) => {
      const note = await store.get(c.req.valid("param").id);
      if (!note) throw new NotFoundError();
      return c.json(note, 200);
    })
    .openapi(create, async (c) => {
      const note = await store.create(c.req.valid("json"));
      c.header("Location", `/v1/notes/${note.id}`);
      return c.json(note, 201);
    });
}
