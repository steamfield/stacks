import { Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { apiErrors, errorClasses } from "../../../../packages/contract/index.ts";

export const sentinel = "PRIVATE_SENTINEL_NEVER_LOG";
const FailureApi = HttpApi.make("ContractFailures").add(
  HttpApiGroup.make("Failures").add(
    HttpApiEndpoint.get("error", "/__contract/errors/:tag", {
      params: Schema.Struct({ tag: Schema.String }),
      success: Schema.Never,
      error: apiErrors,
    }),
    HttpApiEndpoint.get("defect", "/__contract/defect", { success: Schema.Never }),
    HttpApiEndpoint.get("encoding", "/__contract/encoding", {
      success: Schema.Struct({ value: Schema.String.check(Schema.isMinLength(5)) }),
    }),
    HttpApiEndpoint.get("headers", "/__contract/headers", {
      headers: Schema.Struct({ "x-proof": Schema.Literal("yes") }),
      success: Schema.Struct({ ok: Schema.Boolean }),
    }),
  ),
);

const FailureHandlers = HttpApiBuilder.group(FailureApi, "Failures", (handlers) =>
  handlers
    .handle("error", ({ params }) => {
      const ErrorClass = errorClasses.find((ErrorClass) => new ErrorClass()._tag === params.tag);
      return ErrorClass === undefined
        ? Effect.die(new Error("Unknown test error"))
        : Effect.fail(new ErrorClass());
    })
    .handle("defect", () =>
      Effect.sync(() => {
        throw new TypeError(sentinel);
      }),
    )
    .handle("encoding", () => Effect.succeed({ value: "bad" }))
    .handle("headers", () => Effect.succeed({ ok: true })),
);

// Test routes exercise failures without production switches or fake application services.
export const FailureRoutes = Layer.mergeAll(
  HttpApiBuilder.layer(FailureApi).pipe(Layer.provide(FailureHandlers)),
  HttpRouter.add(
    "GET",
    "/__contract/cached",
    Effect.succeed(
      HttpServerResponse.text("cached", {
        headers: { "cache-control": "public, max-age=60" },
      }),
    ),
  ),
  HttpRouter.add(
    "GET",
    "/__contract/not-modified",
    Effect.succeed(HttpServerResponse.empty({ status: 304 })),
  ),
  HttpRouter.add("GET", "/__contract/empty-defect", Effect.die(undefined)),
);
