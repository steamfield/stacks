import { fireEvent, render, screen } from "@testing-library/react";
import { Schema } from "effect";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ErrorEnvelope, errorEnvelope, HealthStatus } from "../../../../packages/contract/index.ts";
import ApiStatus from "./ApiStatus";

afterEach(() => vi.unstubAllGlobals());

it("shows loading until the contract client decodes health from the network", async () => {
  let respond: (response: Response) => void = () => {
    throw new Error("Fetch not started");
  };
  vi.stubGlobal(
    "fetch",
    () =>
      new Promise<Response>((resolve) => {
        respond = resolve;
      }),
  );
  render(<ApiStatus />);
  expect(screen.getByRole("status")).toHaveTextContent("Checking API");
  await vi.waitFor(() => {
    respond(Response.json(Schema.encodeSync(HealthStatus)({ status: "ok" })));
  });
  expect(await screen.findByText("API is ok.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
});

it("shows the fixed envelope message for a declared failure", async () => {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      Response.json(Schema.encodeSync(ErrorEnvelope)(errorEnvelope("BadInput")), { status: 400 }),
    ),
  );
  render(<ApiStatus />);
  expect(await screen.findByText("Invalid request.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
});

it("shows a safe retry state for a network failure", async () => {
  vi.stubGlobal("fetch", () => Promise.reject(new Error("PRIVATE_NETWORK_DETAIL")));
  render(<ApiStatus />);
  expect(await screen.findByText("Could not reach the API.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  expect(screen.queryByText(/PRIVATE_NETWORK_DETAIL/)).toBeNull();
});

it("offers retry for a retryable envelope and recovers through the same typed client", async () => {
  let available = false;
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      available
        ? Response.json(Schema.encodeSync(HealthStatus)({ status: "ok" }))
        : Response.json(Schema.encodeSync(ErrorEnvelope)(errorEnvelope("Unavailable")), {
            status: 503,
          }),
    ),
  );
  render(
    <StrictMode>
      <ApiStatus />
    </StrictMode>,
  );
  expect(await screen.findByText("Service unavailable.")).toBeVisible();
  available = true;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("API is ok.")).toBeVisible();
});

it("renders a safe failure when a successful response violates the contract", async () => {
  vi.stubGlobal("fetch", () => Promise.resolve(Response.json({ status: "PRIVATE_INVALID_BODY" })));
  render(<ApiStatus />);
  expect(await screen.findByText("Could not reach the API.")).toBeVisible();
  expect(screen.queryByText(/PRIVATE_INVALID_BODY/)).toBeNull();
});
