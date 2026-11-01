import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { NotFoundError } from '../common/errors.js';
import type { CreateNoteDto, ListNotesQuery, Note, NotePage } from './dto/note.dto.js';

/**
 * A process-local store in creation order, lost on restart. Controllers see only
 * these async methods, so a database-backed service can replace it. Misses throw
 * NotFoundError; the global filter turns it into the 404 envelope.
 */
@Injectable()
export class NotesService {
  private readonly notes: Note[] = [];

  async list({ limit, cursor }: ListNotesQuery): Promise<NotePage> {
    const start = cursor ? this.notes.findIndex((note) => note.id === cursor) + 1 : 0;
    const items = this.notes.slice(start, start + limit);
    const last = items.at(-1);
    const more = start + items.length < this.notes.length;
    return { items, nextCursor: more && last ? last.id : null };
  }

  async get(id: string): Promise<Note> {
    const note = this.notes.find((candidate) => candidate.id === id);
    if (!note) throw new NotFoundError();
    return note;
  }

  async create(input: CreateNoteDto): Promise<Note> {
    const note: Note = {
      id: randomUUID(),
      title: input.title,
      body: input.body,
      createdAt: new Date().toISOString(),
    };
    this.notes.push(note);
    return note;
  }
}
