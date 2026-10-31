import { expect, it } from "vitest";
import { createMemoryNotes } from "./notes.ts";

it("creates notes with the injected clock and ids, and pages them in order", async () => {
  let n = 0;
  const store = createMemoryNotes({
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    newId: () => `00000000-0000-4000-8000-00000000000${++n}`,
  });
  const a = await store.create({ title: "a", body: "" });
  await store.create({ title: "b", body: "" });

  expect(a).toEqual({
    id: "00000000-0000-4000-8000-000000000001",
    title: "a",
    body: "",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  expect(await store.get(a.id)).toEqual(a);
  expect(await store.get("missing")).toBeUndefined();

  const first = await store.list({ limit: 1 });
  expect(first.items.map((note) => note.title)).toEqual(["a"]);
  const rest = await store.list({ limit: 1, cursor: first.nextCursor ?? undefined });
  expect(rest).toMatchObject({ items: [{ title: "b" }], nextCursor: null });
});
