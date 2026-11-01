import { Schema } from "effect";

export const ItemId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("ItemId"));
export const ItemName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80));

export const Item = Schema.Struct({
  id: ItemId,
  name: ItemName,
  createdAt: Schema.DateTimeUtcFromString,
}).annotate({ title: "Item", description: "An item as it crosses the API boundary" });

export const NewItem = Schema.Struct({ name: ItemName }).annotate({ title: "NewItem" });
export const ItemList = Schema.Struct({ items: Schema.Array(Item) }).annotate({
  title: "ItemList",
});
export const ReadyStatus = Schema.Struct({ status: Schema.Literal("ready") });
