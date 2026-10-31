import { Context, Effect, Layer } from "effect";
import type { CheckPayload, HealthStatus } from "../../../../packages/contract/index.ts";

export class Health extends Context.Service<
  Health,
  {
    readonly get: Effect.Effect<typeof HealthStatus.Type>;
    readonly check: (payload: typeof CheckPayload.Type) => Effect.Effect<typeof HealthStatus.Type>;
  }
>()("api/Health") {
  static readonly layer = Layer.succeed(
    this,
    this.of({
      get: Effect.succeed({ status: "ok" }),
      check: () => Effect.succeed({ status: "ok" }),
    }),
  );
}
