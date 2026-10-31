import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { expect, test } from "vitest";
import { server } from "../../tests/mocks/server";
import { renderApp } from "../../tests/render";
import Home from "./home";

test("renders API health through the generated client and query provider", async () => {
  renderApp(<Home />);
  expect(await screen.findByText("API status: ok")).toBeVisible();
});

test("shows the public failure and lets the user retry", async () => {
  server.use(
    http.get("*/health", () =>
      HttpResponse.json(
        {
          error: {
            code: "UNAVAILABLE",
            message: "Service unavailable.",
            details: null,
            requestId: "test-id",
          },
        },
        { status: 503 },
      ),
    ),
  );
  renderApp(<Home />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Service unavailable.");
  server.resetHandlers();
  await userEvent.setup().click(screen.getByRole("button", { name: "Check again" }));
  expect(await screen.findByText("API status: ok")).toBeVisible();
});

test.each([{ status: "broken" }, {}])("rejects an invalid success body %j", async (body) => {
  server.use(http.get("*/health", () => HttpResponse.json(body)));
  renderApp(<Home />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not read API health.");
});
