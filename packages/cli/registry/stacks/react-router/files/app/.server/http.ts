import { Clock, Effect, Exit, Logger } from "effect";
import { failure } from "./errors";
import { makeLogger } from "./logging";
import { type AppServices, getRuntime } from "./runtime";

async function execute<A, E>(request: Request, program: Effect.Effect<A, E, AppServices>) {
  const runtime = getRuntime();
  const supplied = request.headers.get("x-request-id");
  const requestId =
    supplied !== null && /^[A-Za-z0-9_-]{1,64}$/.test(supplied) ? supplied : crypto.randomUUID();
  const started = Effect.runSync(Clock.currentTimeMillis);
  const exit = await runtime.runPromiseExit(
    program.pipe(
      Effect.map((value) => {
        const original = value instanceof Response ? value : Response.json(value);
        // Rebuild even immutable framework/fetch headers without buffering a stream.
        const response = new Response(original.body, {
          status: original.status,
          statusText: original.statusText,
          headers: original.headers,
        });
        response.headers.set("x-request-id", requestId);
        if (!response.headers.has("cache-control"))
          response.headers.set("cache-control", "no-store");
        return { value, response };
      }),
      Effect.annotateLogs({ requestId }),
    ),
    {
      signal: request.signal,
    },
  );
  const failed = Exit.isFailure(exit) ? failure(exit.cause) : undefined;
  const status = Exit.isSuccess(exit) ? exit.value.response.status : (failed?.status ?? 500);
  const path = new URL(request.url).pathname === "/healthz" ? "/healthz" : "/";
  const log = Effect.gen(function* () {
    if (failed && "defect" in failed)
      yield* Effect.logError("defect").pipe(Effect.annotateLogs({ defect: failed.defect }));
    yield* (path === "/healthz" ? Effect.logDebug : Effect.logInfo)("request").pipe(
      Effect.annotateLogs({
        method: request.method,
        path,
        status,
        durationMs: Math.max(0, (yield* Clock.currentTimeMillis) - started),
      }),
    );
  }).pipe(Effect.annotateLogs({ requestId }));
  // A failed layer cannot supply its own logger. Keep the fallback structured and safe.
  const logged = await runtime.runPromiseExit(log);
  if (Exit.isFailure(logged))
    await Effect.runPromise(
      log.pipe(
        Effect.provide(
          Logger.layer([
            makeLogger((record) => process.stderr.write(`${JSON.stringify(record)}\n`)),
          ]),
        ),
      ),
    );
  const headers = { "x-request-id": requestId, "cache-control": "no-store" };
  if (failed)
    return {
      ok: false as const,
      response: Response.json(
        { message: failed.message, retryable: failed.retryable },
        { status, headers },
      ),
    };
  if (Exit.isFailure(exit)) throw new Error("Unclassified route failure");
  return { ok: true as const, ...exit.value, headers: exit.value.response.headers };
}
export async function runRoute<A, E>(request: Request, program: Effect.Effect<A, E, AppServices>) {
  const result = await execute(request, program);
  return result.response;
}
export async function runData<A, E>(request: Request, program: Effect.Effect<A, E, AppServices>) {
  const result = await execute(request, program);
  if (!result.ok) throw result.response;
  return result;
}
