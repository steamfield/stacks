import { MockTransport } from "@core/mock-transport";
import { act, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { renderWithProviders } from "../../../../tests/render-with-providers";
import { Providers } from "../../providers";
import { ConnectionStatus, Ticks } from "./route";

afterEach(() => vi.useRealTimers());

test("window renders command data and two pushed frames without inventing missing data", async () => {
  const { transport } = renderWithProviders();
  expect(await screen.findByText(/dev · browser/)).toBeVisible();
  expect(screen.getByLabelText("Tick counter")).toHaveTextContent("not available");
  act(() => transport.push({ counter: 1, elapsed_ms: 1000 }));
  expect(screen.getByLabelText("Tick counter")).toHaveTextContent("1");
  act(() => transport.push({ counter: 2, elapsed_ms: 2000 }));
  expect(screen.getByLabelText("Tick counter")).toHaveTextContent("2");
  expect(screen.getByText("Elapsed: 2000 ms")).toBeVisible();
});

test.each([
  ["error", /Application metadata unavailable \(invalid_metadata\)/],
  ["offline", /Desktop connection unavailable/],
])("%s settles loading with a visible failure", async (scenario, message) => {
  renderWithProviders(scenario);
  expect(await screen.findByRole("alert")).toHaveTextContent(message);
  expect(screen.queryByText(/Loading application/)).not.toBeInTheDocument();
});

test("ended streams show reconnecting, resubscribe and detach on unmount", async () => {
  const { transport, unmount } = renderWithProviders();
  await screen.findByText(/dev · browser/);
  vi.useFakeTimers();
  act(() => transport.push({ counter: 2, elapsed_ms: 2000 }));
  act(() => transport.end());
  expect(screen.getByRole("status", { name: "Connection" })).toHaveTextContent("reconnecting");
  act(() => vi.advanceTimersByTime(1000));
  act(() => transport.push({ counter: 3, elapsed_ms: 3000 }));
  expect(screen.getByRole("status", { name: "Connection" })).toHaveTextContent("live");
  expect(screen.getByLabelText("Tick counter")).toHaveTextContent("3");
  act(() => transport.end());
  unmount();
  act(() => vi.advanceTimersByTime(2000));
  expect(transport.observers.size).toBe(0);
});

test("counter updates leave the connection-status sibling alone", () => {
  const transport = new MockTransport(new URLSearchParams({ ticks: "off" }));
  let renders = 0;
  render(
    <Providers transport={transport}>
      <main>
        <Profiler id="connection" onRender={() => renders++}>
          <ConnectionStatus />
        </Profiler>
        <Ticks />
      </main>
    </Providers>,
  );
  act(() => transport.push({ counter: 1, elapsed_ms: 1000 }));
  const before = renders;
  act(() => transport.push({ counter: 2, elapsed_ms: 2000 }));
  expect(screen.getByLabelText("Tick counter")).toHaveTextContent("2");
  expect(renders).toBe(before);
});
