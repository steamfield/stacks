import {
  ByteSize,
  Cause,
  Clock,
  Effect,
  Layer,
  Logger,
  Path,
  PlatformError,
  References,
} from "effect";
import {
  HttpIncomingMessage,
  HttpPlatform,
  HttpRouter,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
  HttpStaticServer,
} from "effect/http";
import { HttpApiBuilder, HttpApiError } from "effect/http-api";
import {
  Api,
  apiErrorTable,
  errorEnvelope,
  tagForStatus,
} from "../../../packages/contract/index.ts";
import { AppConfig } from "./config.ts";
import { HealthHandlers } from "./handlers/health.ts";
import { Health } from "./services/health.ts";

export const AppLayer = Layer.mergeAll(AppConfig.layer, Health.layer);

const envelopeResponse = (status: number) =>
  HttpServerResponse.jsonUnsafe(errorEnvelope(tagForStatus(status)), { status });

function responseHeaders(
  original: HttpServerResponse.HttpServerResponse,
  requestId: string,
  siteResponse: boolean,
) {
  const response =
    original.status >= 400 && !siteResponse ? envelopeResponse(original.status) : original;
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

function isSiteRequest(request: HttpServerRequest.HttpServerRequest) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const pathname = request.url.split("?")[0] ?? "/";
  try {
    const normalized = decodeURIComponent(pathname).replace(/\/+/g, "/").toLowerCase();
    return !/^\/(?:v1(?:\/|$)|healthz(?:\/|$)|openapi\.json(?:\/|$)|__contract(?:\/|$))/.test(
      normalized,
    );
  } catch {
    // Malformed escapes must not open the static fallback.
    return false;
  }
}

function isSiteMiss(error: HttpServerError.HttpServerError) {
  const reason = error.reason;
  if (reason._tag === "RouteNotFound") return true;
  if (reason._tag !== "InternalError" || !PlatformError.isPlatformError(reason.cause)) return false;
  if (reason.cause.reason._tag !== "BadResource") return false;
  const cause = reason.cause.reason.cause;
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOTDIR";
}

const requestRecord = Effect.fn("request.record")(function* (
  request: HttpServerRequest.HttpServerRequest,
  response: HttpServerResponse.HttpServerResponse,
  started: number,
) {
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
});

export const RequestMiddleware = HttpRouter.middleware(
  Effect.gen(function* () {
    const config = yield* AppConfig;
    const loggers = yield* Logger.CurrentLoggers;
    const minimum = yield* References.MinimumLogLevel;
    const paths = yield* Path.Path;
    const platform = yield* HttpPlatform.HttpPlatform;
    const site =
      config.staticDir === ""
        ? undefined
        : yield* HttpStaticServer.make({
            root: config.staticDir,
          });
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
          let original =
            // This API declares no HEAD endpoints; the router's implicit GET fallback is disabled.
            yield* (
              request.method === "HEAD" ? Effect.succeed(envelopeResponse(404)) : httpEffect
            ).pipe(Effect.catchCause(recover));
          const siteResponse =
            site !== undefined && original.status === 404 && isSiteRequest(request);
          if (siteResponse && site !== undefined) {
            original = yield* site.pipe(
              Effect.catchIf(isSiteMiss, () =>
                HttpServerResponse.file(paths.join(config.staticDir, "404.html")).pipe(
                  Effect.map(HttpServerResponse.setStatus(404)),
                  Effect.provideService(HttpPlatform.HttpPlatform, platform),
                ),
              ),
              Effect.catchCause(recover),
            );
          }
          const response = responseHeaders(original, requestId, siteResponse);
          yield* requestRecord(request, response, started);
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
