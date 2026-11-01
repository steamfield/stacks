import { Clock, Context, DateTime, Effect, Layer, Ref } from "effect";
import { Conflict, type Unavailable } from "../errors.ts";
import { type Item, ItemId } from "../schemas/items.ts";

export type ItemValue = typeof Item.Type;

/** The items store. The Postgres layer is ItemsSql in items-sql.ts. */
export class Items extends Context.Service<
  Items,
  {
    readonly list: Effect.Effect<ReadonlyArray<ItemValue>, Unavailable>;
    readonly create: (name: string) => Effect.Effect<ItemValue, Conflict | Unavailable>;
  }
>()("api/Items") {
  /** Process-local store for the ordinary, Docker-free tests. */
  static readonly layerMemory = Layer.effect(
    this,
    Effect.gen(function* () {
      const store = yield* Ref.make<ReadonlyArray<ItemValue>>([]);
      return Items.of({
        list: Ref.get(store),
        create: (name) =>
          Effect.gen(function* () {
            if ((yield* Ref.get(store)).some((item) => item.name === name))
              return yield* new Conflict();
            const item: ItemValue = {
              id: ItemId.make(crypto.randomUUID()),
              name,
              createdAt: DateTime.makeUnsafe(yield* Clock.currentTimeMillis),
            };
            yield* Ref.update(store, (items) => [...items, item]);
            return item;
          }),
      });
    }),
  );
}
