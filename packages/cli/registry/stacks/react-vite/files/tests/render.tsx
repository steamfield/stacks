import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, type RouteObject, RouterProvider } from "react-router";
import { createApiClient } from "../src/api/client";
import { createQueryClient } from "../src/api/query-client";
import { routes as appRoutes } from "../src/app/routes";
import { type Services, ServicesProvider } from "../src/app/services";
import { createLogger, type Logger } from "../src/logging";
import { TEST_API_URL } from "./msw/server";

/**
 * Renders the real app at `path`: the app's routes in a memory router, a fresh query client and
 * a real API client whose requests MSW answers. `routes` replaces the app's routes for a test
 * that needs a page the app doesn't have (one that throws).
 */
export function renderRoute(
  path: string,
  options: { logger?: Logger; routes?: RouteObject[] } = {},
) {
  const logger = options.logger ?? createLogger("silent");
  const services: Services = { api: createApiClient({ baseUrl: TEST_API_URL, logger }), logger };
  const router = createMemoryRouter(options.routes ?? appRoutes, { initialEntries: [path] });
  const view = render(
    <ServicesProvider services={services}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ServicesProvider>,
  );
  return { ...view, router };
}
