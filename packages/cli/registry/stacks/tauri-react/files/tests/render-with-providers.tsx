/**
 * Renders the application router inside real providers with a controllable mock transport.
 * Route tests use the returned transport to push ticks and choose failure scenarios.
 */

import { MockTransport } from "@core/mock-transport";
import { render } from "@testing-library/react";
import { RouterProvider } from "react-router";
import { Providers } from "../src/app/providers";
import { createAppRouter } from "../src/app/router";

export function renderWithProviders(scenario = "ok") {
  const transport = new MockTransport(new URLSearchParams({ scenario, ticks: "off" }));
  return {
    transport,
    ...render(
      <Providers transport={transport}>
        <RouterProvider router={createAppRouter(transport.windowLabel)} />
      </Providers>,
    ),
  };
}
