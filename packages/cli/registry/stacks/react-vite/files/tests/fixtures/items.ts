import type { Item } from "../../src/api/items";

/** What the fake API serves in component tests (MSW) and browser tests (Playwright routes). */
export const items: Item[] = [
  { id: "1", name: "First item", description: "The first item the API returned." },
  { id: "2", name: "Second item", description: "The second item the API returned." },
];
