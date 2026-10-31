import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { items } from "../fixtures/items";

/** The API base tests use: the app's default, a same-origin path. */
export const TEST_API_URL = "/api";

/** The fake API's default answers. A test changes one with server.use(...) for its own case. */
export const handlers = [
  http.get("*/api/items", () => HttpResponse.json({ items })),
  http.get("*/api/items/:id", ({ params }) => {
    const item = items.find((candidate) => candidate.id === params.id);
    return item
      ? HttpResponse.json(item)
      : HttpResponse.json({ message: "Not found" }, { status: 404 });
  }),
];

export const server = setupServer(...handlers);
