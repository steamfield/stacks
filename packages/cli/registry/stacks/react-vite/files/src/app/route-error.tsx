import { useEffect } from "react";
import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { useServices } from "./services";

/** The error page: an unmatched URL (404) or an error thrown while rendering a route. */
export function RouteError() {
  const error = useRouteError();
  const { logger } = useServices();
  const notFound = isRouteErrorResponse(error) && error.status === 404;

  useEffect(() => {
    if (notFound) return;
    // The error's name only: a thrown message can carry user data.
    logger.error("route_error", { name: error instanceof Error ? error.name : typeof error });
  }, [error, notFound, logger]);

  return (
    <main className="shell-main">
      <h1>{notFound ? "Page not found" : "Something went wrong"}</h1>
      <p>
        {notFound
          ? "There's no page at this address."
          : "This page failed to load. Reload to try again."}
      </p>
      <Link to="/">Back to items</Link>
    </main>
  );
}
