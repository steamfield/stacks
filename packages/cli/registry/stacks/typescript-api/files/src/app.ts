import { ByteSize, Cause, Clock, Effect, Layer, Logger, References } from "effect";
import {
  HttpIncomingMessage,
  HttpRouter,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import { HttpApiBuilder, HttpApiError } from "effect/http-api";
import { Api } from "./api.ts";
import { AppConfig } from "./config.ts";
import { apiErrorTable, errorEnvelope, tagForStatus } from "./errors.ts";
import { HealthHandlers } from "./handlers/health.ts";
import { Health } from "./services/health.ts";

export const AppLayer = Layer.mergeAll(AppConfig.layer, Health.layer);

const envelopeResponse = (status: number) =>
  HttpServerResponse.jsonUnsafe(errorEnvelope(tagForStatus(status)), { status });

function responseHeaders(original: HttpServerResponse.HttpServerResponse, requestId: string) {
  const response = original.status >= 400 ? envelopeResponse(original.status) : original;
  const identified = HttpServerResponse.setHeader(response, "x-request-id", requestId);
  if (identified.status === 304) return identified;
  return HttpServerResponse.setHeader(
    identified,
    "cache-control",
    original.headers["cache-control"] ?? "no-store",
  );
}

function requestFailureStatus(error: unknown): number | undefined {
  if (HttpApiError.HttpApiSchemaError.is(error)) {
    if (error.kind === "Body" || error.kind === "ResponseHeaders") return undefined;
    return 400;
  }
  if (error instanceof HttpServerError.HttpServerError && error.reason._tag === "RouteNotFound")
    return 404;
  if (error instanceof HttpServerError.HttpServerError && error.reason._tag === "RequestParseError")
    return error.reason.reason === "BodyTooLarge" ? 413 : 400;
  if (HttpApiError.HttpApiPayloadTooLarge.is(error)) return 413;
  return undefined;
}

const recover = Effect.fn("request.recover")(function* (cause: Cause.Cause<unknown>) {
  if (Cause.hasInterruptsOnly(cause)) return yield* Effect.failCause(cause);
  let status: number = apiErrorTable.Defect.status;
  for (const reason of cause.reasons) {
    if (Cause.isInterruptReason(reason)) continue;
    const error = Cause.isFailReason(reason) ? reason.error : reason.defect;
    const requestStatus = requestFailureStatus(error);
    if (requestStatus === undefined) {
      yield* Effect.logError("defect").pipe(Effect.annotateLogs({ defect: error }));
      return envelopeResponse(apiErrorTable.Defect.status);
    }
    status = requestStatus;
  }
  return envelopeResponse(status);
});

export const RequestMiddleware = HttpRouter.middleware(
  Effect.gen(function* () {
    const config = yield* AppConfig;
    const loggers = yield* Logger.CurrentLoggers;
    const minimum = yield* References.MinimumLogLevel;
    return (httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, unknown>) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const supplied = request.headers["x-request-id"];
        const requestId =
          supplied !== undefined && /^[A-Za-z0-9_-]{1,64}$/.test(supplied)
            ? supplied
            : crypto.randomUUID();
        const started = yield* Clock.currentTimeMillis;
        return yield* Effect.gen(function* () {
          const response = responseHeaders(
            // This API declares no HEAD endpoints; the router's implicit GET fallback is disabled.
            yield* (
              request.method === "HEAD" ? Effect.succeed(envelopeResponse(404)) : httpEffect
            ).pipe(Effect.catchCause(recover)),
            requestId,
          );
          const route = yield* Effect.serviceOption(HttpRouter.RouteContext);
          const path = route._tag === "Some" ? route.value.route.path : "<unmatched>";
          const log = path === "/healthz" ? Effect.logDebug : Effect.logInfo;
          yield* log("request").pipe(
            Effect.annotateLogs({
              method: request.method,
              path,
              status: response.status,
              durationMs: Math.max(0, (yield* Clock.currentTimeMillis) - started),
            }),
          );
          return response;
        }).pipe(Effect.annotateLogs({ requestId }));
      }).pipe(
        Effect.provideService(Logger.CurrentLoggers, loggers),
        Effect.provideService(References.MinimumLogLevel, minimum),
        Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(config.maxBodyBytes)),
      );
  }),
  { global: true },
);

export const App = Layer.mergeAll(
  HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(Layer.provide(HealthHandlers)),
  RequestMiddleware,
).pipe(Layer.provide(AppLayer));
