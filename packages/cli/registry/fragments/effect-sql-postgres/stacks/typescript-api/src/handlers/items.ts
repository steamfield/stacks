import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Api } from "../api.ts";
import { Items } from "../services/items.ts";

export const ItemsHandlers = HttpApiBuilder.group(
  Api,
  "Items",
  Effect.fn(function* (handlers) {
    const items = yield* Items;
    return handlers
      .handle("list", () => Effect.map(items.list, (list) => ({ items: list })))
      .handle("create", ({ payload }) => items.create(payload.name));
  }),
);
