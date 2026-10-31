import { renderToReadableStream } from "react-dom/server";
import { type EntryContext, ServerRouter } from "react-router";

export default async function handleRequest(
  request: Request,
  status: number,
  headers: Headers,
  context: EntryContext,
) {
  let shellRendered = false;
  const body = await renderToReadableStream(<ServerRouter context={context} url={request.url} />, {
    signal: request.signal,
    onError(error: unknown) {
      status = 500;
      // React Router logs initial failures when the render promise rejects.
      if (shellRendered) handleError(error, { request });
    },
  });
  shellRendered = true;
  await body.allReady;
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(body, { status, headers });
}

export function handleError(error: unknown, { request }: { request: Request }) {
  if (request.signal.aborted) return;
  console.error(
    JSON.stringify({
      event: "request.error",
      errorClass: error instanceof Error ? error.name : "Unknown",
    }),
  );
}
