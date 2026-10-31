import type { Note, NoteInput, NoteListQuery, NotePage } from "../schemas/notes.ts";

/** Where notes live. The routes see only this interface, so a database store can replace it. */
export type NotesStore = {
  list(query: NoteListQuery): Promise<NotePage>;
  get(id: string): Promise<Note | undefined>;
  create(input: NoteInput): Promise<Note>;
};

export type MemoryNotesOptions = {
  now?: () => Date;
  newId?: () => string;
};

/** A process-local store in creation order. State is lost on restart. */
export function createMemoryNotes(options: MemoryNotesOptions = {}): NotesStore {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => crypto.randomUUID());
  const notes: Note[] = [];

  return {
    async list({ limit, cursor }) {
      const start = cursor ? notes.findIndex((note) => note.id === cursor) + 1 : 0;
      const items = notes.slice(start, start + limit);
      const last = items.at(-1);
      const more = start + items.length < notes.length;
      return { items, nextCursor: more && last ? last.id : null };
    },
    async get(id) {
      return notes.find((note) => note.id === id);
    },
    async create(input) {
      const note: Note = { id: newId(), ...input, createdAt: now().toISOString() };
      notes.push(note);
      return note;
    },
  };
}
