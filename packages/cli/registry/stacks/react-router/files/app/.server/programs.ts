import { Effect, Schema } from "effect";
import { GreetingData, GreetingInput, HealthData } from "../schemas/greeting";
import { AppConfig } from "./config";
import { BadInput, PayloadTooLarge, UnsupportedMediaType } from "./errors";
import { Health } from "./services/health";

export const home = Effect.gen(function* () {
  return yield* Schema.encodeEffect(GreetingData)(yield* (yield* Health).greeting());
});
export const health = Effect.gen(function* () {
  return yield* Schema.encodeEffect(HealthData)(yield* (yield* Health).get);
});
const readBody = Effect.fn("readBody")(function* (request: Request) {
  const { maxBodyBytes } = yield* AppConfig;
  if (request.body === null) return "";
  return yield* Effect.acquireUseRelease(
    Effect.sync(() => request.body?.getReader()),
    (reader) =>
      Effect.tryPromise({
        try: async () => {
          if (reader === undefined) return "";
          const chunks: Uint8Array[] = [];
          let size = 0;
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > maxBodyBytes) throw new PayloadTooLarge();
            chunks.push(chunk.value);
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        },
        catch: (error) => (error instanceof PayloadTooLarge ? error : new BadInput()),
      }),
    (reader) =>
      Effect.promise(async () => {
        await reader?.cancel();
        reader?.releaseLock();
      }).pipe(Effect.ignoreCause),
  );
});
export const greet = Effect.fn("greet")(function* (request: Request) {
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  let payload: unknown;
  if (contentType === "application/json") {
    const text = yield* readBody(request);
    payload = yield* Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: () => new BadInput(),
    });
  } else if (contentType === "application/x-www-form-urlencoded") {
    payload = Object.fromEntries(new URLSearchParams(yield* readBody(request)));
  } else return yield* new UnsupportedMediaType();
  const input = yield* Schema.decodeUnknownEffect(GreetingInput)(payload, {
    onExcessProperty: "error",
  }).pipe(Effect.mapError(() => new BadInput()));
  return yield* Schema.encodeEffect(GreetingData)(yield* (yield* Health).greeting(input.name));
});
