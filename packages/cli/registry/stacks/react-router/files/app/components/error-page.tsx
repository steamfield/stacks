import { isRouteErrorResponse, Link, useRevalidator, useRouteError } from "react-router";
import { Button } from "./ui/button";

export function ErrorPage() {
  const error: unknown = useRouteError();
  const revalidator = useRevalidator();
  let message = "Internal server error.";
  let retryable = true;
  let status = 500;
  if (isRouteErrorResponse(error)) {
    status = error.status;
    const body: unknown = error.data;
    if (
      body !== null &&
      typeof body === "object" &&
      "message" in body &&
      typeof body.message === "string" &&
      "retryable" in body &&
      typeof body.retryable === "boolean"
    ) {
      message = body.message;
      retryable = body.retryable;
    } else if (status === 404) {
      message = "Resource not found.";
      retryable = false;
    }
  }
  return (
    <main className="mx-auto max-w-lg space-y-4 px-6 py-16">
      <h1 className="text-2xl font-semibold">
        {status === 404 ? "Page not found" : "Request failed"}
      </h1>
      <p role="alert">{message}</p>
      {retryable && (
        <Button onClick={() => revalidator.revalidate()} disabled={revalidator.state !== "idle"}>
          Retry
        </Button>
      )}
      <p>
        <Link className="underline" to="/">
          Return home
        </Link>
      </p>
    </main>
  );
}
