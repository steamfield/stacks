// The project's Schema conventions as running checks: a branded id, a transformation that
// round-trips, a property over generated values, readable failures, a closed JSON Schema
// document and the Standard Schema adapter. Copy these patterns for new boundary schemas.
import { Arbitrary, Effect, Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";

const OrderId = Schema.String.check(Schema.isMinLength(1)).pipe(Schema.brand("OrderId"));

const Order = Schema.Struct({
  id: OrderId,
  quantity: Schema.Int.check(Schema.isGreaterThan(0)),
  placedAt: Schema.DateTimeUtcFromString,
  note: Schema.optionalKey(Schema.String),
}).annotate({ title: "Order", description: "An order as it crosses the API boundary" });
type Order = typeof Order.Type;

const decode = Schema.decodeUnknownSync(Order);
const encode = Schema.encodeSync(Order);

describe("Schema conventions", () => {
  it("round-trips wire input: encode(decode(x)) equals x", () => {
    const wire = { id: "order-1", quantity: 2, placedAt: "2026-01-02T03:04:05.000Z" };
    const order: Order = decode(wire);
    expect(encode(order)).toEqual(wire);
  });

  it("round-trips every generated value", async () => {
    const result = await Effect.runPromise(
      Arbitrary.checkEffect(Arbitrary.schema(Order), (order) => {
        const wire = encode(order);
        return JSON.stringify(encode(decode(wire))) === JSON.stringify(wire);
      }),
    );
    expect(Arbitrary.formatCheckFailure(result)).toBeUndefined();
  });

  it("names the failing field in a readable error", () => {
    const exit = Schema.decodeUnknownExit(Order)({
      id: "order-1",
      quantity: 0,
      placedAt: "2026-01-02T03:04:05.000Z",
    });
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(String(exit.cause)).toContain("quantity");
  });

  it("emits a closed JSON Schema document for tools", () => {
    const document = Schema.toJsonSchemaDocument(Order, { onExcessProperty: "error" });
    expect(document.schema).toMatchObject({ type: "object", additionalProperties: false });
  });

  it("adapts to Standard Schema for validation-only libraries", async () => {
    const standard = Schema.toStandardSchemaV1(Order);
    const result = await standard["~standard"].validate({ id: "", quantity: 1 });
    expect("issues" in result && result.issues !== undefined).toBe(true);
  });
});
