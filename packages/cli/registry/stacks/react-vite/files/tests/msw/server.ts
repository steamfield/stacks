/**
 * Defines the in-process MSW API used by Vitest's client and component tests. Default note
 * handlers read shared fixtures, and individual tests can override responses.
 */

import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { notes } from "../fixtures/notes";

/** The API base tests use: the app's default, a same-origin path. */
export const TEST_API_URL = "/api";

/** The fake API's default answers. A test changes one with server.use(...) for its own case. */
export const handlers = [
  http.get("*/api/v1/notes", () => HttpResponse.json({ items: notes, nextCursor: null })),
  http.get("*/api/v1/notes/:id", ({ params }) => {
    const note = notes.find((candidate) => candidate.id === params.id);
    return note
      ? HttpResponse.json(note)
      : HttpResponse.json({ message: "Not found" }, { status: 404 });
  }),
];

export const server = setupServer(...handlers);
