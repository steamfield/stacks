import type { Note } from "../../src/api/notes";

/** What the fake API serves in component tests (MSW) and browser tests (Playwright routes). */
export const notes: Note[] = [
  {
    id: "1",
    title: "First note",
    body: "The first note the API returned.",
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "2",
    title: "Second note",
    body: "The second note the API returned.",
    createdAt: "2026-01-02T00:00:00Z",
  },
];
