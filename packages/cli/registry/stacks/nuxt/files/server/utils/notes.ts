import type { Note } from "#shared/schemas/note";

// Process-local and shared by every user: it resets on restart and isn't persistence. Kept on
// globalThis so dev-server reloads don't wipe it.
const store: typeof globalThis & { nuxtNotes?: Note[] } = globalThis;

function notes(): Note[] {
  store.nuxtNotes ??= [
    { id: "first", text: "Read the code", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "second", text: "Run the checks", createdAt: "2026-01-01T00:00:01.000Z" },
  ];
  return store.nuxtNotes;
}

export async function listNotes(): Promise<Note[]> {
  return notes().map((note) => ({ ...note }));
}

export async function addNote(text: string): Promise<Note> {
  const note = { id: crypto.randomUUID(), text, createdAt: new Date().toISOString() };
  notes().push(note);
  return { ...note };
}

export function resetNotesForTest() {
  if (process.env.NODE_ENV !== "test") throw new Error("Note reset is test-only.");
  store.nuxtNotes = undefined;
}
