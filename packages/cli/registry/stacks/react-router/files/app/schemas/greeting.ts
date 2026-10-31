import { Schema } from "effect";

export const GreetingInput = Schema.Struct({
  name: Schema.String.check(Schema.isPattern(/\S/), Schema.isMaxLength(64)),
});
export const GreetingData = Schema.Struct({ message: Schema.String });
export const HealthData = Schema.Struct({ status: Schema.Literal("ok") });
export const ErrorBody = Schema.Struct({ message: Schema.String, retryable: Schema.Boolean });
