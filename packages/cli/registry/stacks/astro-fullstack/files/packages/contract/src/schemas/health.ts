import { Schema } from "effect";

export const HealthStatus = Schema.Struct({ status: Schema.Literal("ok") });
export const CheckPayload = Schema.Struct({
  message: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
});
export const CheckParams = Schema.Struct({ checkId: Schema.Literal("live") });
export const CheckQuery = Schema.Struct({
  verbose: Schema.optionalKey(Schema.Literals(["true", "false"])),
});
export const NoQuery = Schema.Record(Schema.String, Schema.Never);
