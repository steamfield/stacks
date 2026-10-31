import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { expect, test, vi } from "vitest";
import { server } from "../../tests/msw/server";
import { renderRoute } from "../../tests/render";
import { createLogger } from "../logging";
import { routes } from "./routes";

function Broken(): never {
  throw new TypeError("render failed");
}

test("lists items from the API and opens one", async () => {
  renderRoute("/");
  expect(screen.getByRole("status")).toHaveTextContent("Loading items");
  await userEvent.click(await screen.findByRole("link", { name: "Second item" }));
  expect(await screen.findByRole("heading", { name: "Second item" })).toBeVisible();
  expect(screen.getByText("The second item the API returned.")).toBeVisible();
});

test("shows the empty state", async () => {
  server.use(http.get("*/api/items", () => HttpResponse.json({ items: [] })));
  renderRoute("/");
  expect(await screen.findByText("No items yet.")).toBeVisible();
});

test("shows a failed request with its request id, then recovers on retry", async () => {
  server.use(
    http.get(
      "*/api/items",
      () => HttpResponse.json({}, { status: 500, headers: { "x-request-id": "req-500" } }),
      { once: true },
    ),
  );
  renderRoute("/");
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("The server had a problem.");
  expect(alert).toHaveTextContent("Request ID: req-500");
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("link", { name: "First item" })).toBeVisible();
});

test("a deep link to a missing item says so", async () => {
  renderRoute("/items/404");
  expect(await screen.findByRole("heading", { name: "Item not found" })).toBeVisible();
});

test("an unknown address renders the not-found page", async () => {
  renderRoute("/no/such/page");
  expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Back to items" })).toHaveAttribute("href", "/");
});

test("an item the API sends in the wrong shape shows the decode error", async () => {
  server.use(http.get("*/api/items/:id", () => HttpResponse.json({ items: null })));
  renderRoute("/items/1");
  expect(await screen.findByRole("alert")).toHaveTextContent("can't read");
});

test("a page that throws while rendering gets the error page, and the error is logged", async () => {
  const [root] = routes;
  if (!root || root.index) throw new Error("expected the layout route first");
  const logger = createLogger("silent");
  const logged = vi.spyOn(logger, "error");
  // React reports the caught render error on the console; keep test output to failures.
  vi.spyOn(console, "error").mockImplementation(() => {});
  renderRoute("/", {
    logger,
    routes: [{ ...root, children: [{ index: true, Component: Broken }] }],
  });
  expect(await screen.findByRole("heading", { name: "Something went wrong" })).toBeVisible();
  expect(logged).toHaveBeenCalledWith("route_error", { name: "TypeError" });
});
