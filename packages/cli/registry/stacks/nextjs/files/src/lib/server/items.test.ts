import { beforeEach, expect, it } from "vitest";
import { addItem, listItems, resetItemsForTest } from "./items";

beforeEach(resetItemsForTest);

it("starts with two seeds and lists an added item", async () => {
  expect((await listItems()).map((item) => item.name)).toEqual([
    "Read the code",
    "Run the checks",
  ]);
  const added = await addItem("New item");
  expect(added.id).not.toBe("");
  expect(await listItems()).toContainEqual(added);
});

it("does not share prior test writes or expose mutable store objects", async () => {
  const items = await listItems();
  expect(items).toHaveLength(2);
  const first = items[0];
  if (first === undefined) throw new Error("Missing seed");
  first.name = "Changed outside the service";
  items.length = 0;
  expect((await listItems())[0]?.name).toBe("Read the code");
  const added = await addItem("Unchanged");
  added.name = "Changed return value";
  expect((await listItems()).at(-1)?.name).toBe("Unchanged");
});
