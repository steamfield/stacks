import { Context, Effect, Layer } from "effect";
import type { GreetingData, HealthData } from "../../schemas/greeting";
import { AppConfig } from "../config";

export class Health extends Context.Service<
  Health,
  {
    readonly get: Effect.Effect<typeof HealthData.Type>;
    readonly greeting: (name?: string) => Effect.Effect<typeof GreetingData.Type>;
  }
>()("app/Health") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      return Health.of({
        get: Effect.succeed({ status: "ok" }),
        greeting: (name = "world") =>
          Effect.succeed({ message: `${config.greeting}, ${name.trim()}!` }),
      });
    }),
  );
}
