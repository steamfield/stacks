import { beforeEach, expect, it } from "vitest";
import { addNote, listNotes, resetNotesForTest } from "./notes";

beforeEach(resetNotesForTest);

it("starts with two seed notes and returns independent copies", async () => {
  const notes = await listNotes();
  expect(notes.map((note) => note.text)).toEqual(["Read the code", "Run the checks"]);
  notes.splice(0);
  expect(await listNotes()).toHaveLength(2);
});

it("adds a note with an id and time, without carrying state across tests", async () => {
  expect(await listNotes()).toHaveLength(2);
  const added = await addNote("A new note");
  expect(added.id).toBeTruthy();
  expect(Date.parse(added.createdAt)).not.toBeNaN();
  expect(await listNotes()).toContainEqual(added);
});
