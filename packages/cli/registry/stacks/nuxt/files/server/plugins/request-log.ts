import type { H3Event } from "h3";

// Request IDs and one structured log line per request, from Nitro's lifecycle hooks.
// Logs the path without its query string, and an unexpected error's class only.
declare module "h3" {
  interface H3EventContext {
    requestId?: string;
    startedAt?: number;
    logged?: boolean;
  }
}

function logRequest(event: H3Event, status: number) {
  if (event.context.logged) return;
  event.context.logged = true;
  const started = event.context.startedAt ?? performance.now();
  log("info", "request", {
    requestId: event.context.requestId,
    method: event.method,
    path: event.path.split("?")[0],
    status,
    durationMs: Math.round(performance.now() - started),
  });
}

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook("request", (event) => {
    event.context.requestId = crypto.randomUUID();
    event.context.startedAt = performance.now();
    setResponseHeader(event, "x-request-id", event.context.requestId);
  });

  nitro.hooks.hook("afterResponse", (event) => {
    logRequest(event, getResponseStatus(event));
  });

  // A thrown error (createError() or a bug) skips afterResponse, so it is logged here.
  nitro.hooks.hook("error", (error, { event }) => {
    if (!event) return;
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    logRequest(event, status);
    if (status < 500) return;
    const cause = (error as { cause?: unknown }).cause ?? error;
    log("error", "unexpected-error", {
      requestId: event.context.requestId,
      errorType: cause instanceof Error ? cause.name : typeof cause,
    });
  });
});
