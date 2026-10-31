import { Effect } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { Api, apiErrorTable } from "../../../../packages/contract/index.ts";

export function health(signal: AbortSignal) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* HttpApiClient.make(Api);
      return yield* client.Health.get({ query: {} });
    }).pipe(
      Effect.map((value) => ({ ok: true, message: `API is ${value.status}.`, retryable: false })),
      Effect.catch((error) => {
        if ("_tag" in error && Object.hasOwn(apiErrorTable, error._tag)) {
          const row = Object.entries(apiErrorTable).find(([tag]) => tag === error._tag)?.[1];
          if (row !== undefined)
            return Effect.succeed({ ok: false, message: row.message, retryable: row.retryable });
        }
        return Effect.succeed({ ok: false, message: "Could not reach the API.", retryable: true });
      }),
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.Fetch, globalThis.fetch),
    ),
    { signal },
  );
}
