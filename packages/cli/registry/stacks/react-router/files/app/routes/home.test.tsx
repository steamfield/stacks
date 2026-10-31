// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { afterEach, expect, it } from "vitest";
import { args, useTestRuntime } from "../../tests/helpers/runtime";
import { ErrorPage } from "../components/error-page";
import Home, { action, loader } from "./home";

afterEach(cleanup);

it("renders loader data and submits the form through the real action and runtime", async () => {
  useTestRuntime();
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: Home,
      ErrorBoundary: ErrorPage,
      loader: ({ request }) => loader(args(request)),
      action: ({ request }) => action(args(request)),
    },
  ]);
  render(<Stub initialEntries={["/"]} />);
  expect(await screen.findByRole("status")).toHaveTextContent("Hello, world!");
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Your name"), "Ada");
  await user.click(screen.getByRole("button", { name: "Greet" }));
  expect(await screen.findByText("Hello, Ada!")).toBeVisible();
});

it("renders a non-retryable validation error from the real server action", async () => {
  useTestRuntime();
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: Home,
      ErrorBoundary: ErrorPage,
      loader: ({ request }) => loader(args(request)),
      action: ({ request }) => action(args(request)),
    },
  ]);
  render(<Stub initialEntries={["/"]} />);
  await screen.findByRole("status");
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Your name"), "   ");
  await user.click(screen.getByRole("button", { name: "Greet" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Invalid request.");
  expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
});

it.each([404, 503, 500])("renders the %s boundary without exposing a raw error", async (status) => {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: Home,
      ErrorBoundary: ErrorPage,
      loader: () => {
        if (status === 500) throw new Error("PRIVATE_SENTINEL");
        throw Response.json(
          {
            message: status === 404 ? "Resource not found." : "Service unavailable.",
            retryable: status === 503,
          },
          { status },
        );
      },
    },
  ]);
  render(<Stub initialEntries={["/"]} />);
  const alert = await screen.findByRole("alert");
  const message = status === 404 ? "Resource not found." : "Service unavailable.";
  expect(alert).toHaveTextContent(status === 500 ? "Internal server error." : message);
  expect(alert).not.toHaveTextContent("PRIVATE_SENTINEL");
  expect(screen.queryByRole("button", { name: "Retry" }) !== null).toBe(status !== 404);
});
