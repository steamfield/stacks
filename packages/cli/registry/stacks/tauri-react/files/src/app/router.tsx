/**
 * Builds the window's memory router and renders route failures visibly.
 * The entry selects the initial route using the transport's window label.
 */

import { createMemoryRouter, useRouteError } from "react-router";
import { MainRoute } from "./routes/main/route";

export function RouteError() {
  const error = useRouteError();
  return (
    <main>
      <h1>Unable to display this window</h1>
      <p role="alert">{error instanceof Error ? error.message : "Unexpected route error"}</p>
    </main>
  );
}

export function createAppRouter(windowLabel: string) {
  return createMemoryRouter(
    [
      { path: "/", element: <MainRoute />, errorElement: <RouteError /> },
      { path: "/unknown", element: <p role="alert">Unknown window</p> },
    ],
    { initialEntries: [windowLabel === "main" ? "/" : "/unknown"] },
  );
}
