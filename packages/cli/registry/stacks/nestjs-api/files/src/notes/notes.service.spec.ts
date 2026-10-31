import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { NotFoundError } from '../common/errors.js';
import { NotesService } from './notes.service.js';

describe('NotesService', () => {
  let notes: NotesService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [NotesService],
    }).compile();
    notes = moduleRef.get(NotesService);
  });

  it('creates a note with an id and a creation time', async () => {
    const note = await notes.create({ title: 'First', body: 'Hello' });
    expect(note).toMatchObject({ title: 'First', body: 'Hello' });
    expect(note.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(note.createdAt)).not.toBeNaN();
    await expect(notes.get(note.id)).resolves.toEqual(note);
  });

  it('pages in creation order with nextCursor', async () => {
    for (const title of ['a', 'b', 'c']) await notes.create({ title, body: '' });
    const first = await notes.list({ limit: 2 });
    expect(first.items.map((note) => note.title)).toEqual(['a', 'b']);
    expect(first.nextCursor).toBe(first.items[1]?.id);
    const second = await notes.list({ limit: 2, cursor: first.nextCursor ?? '' });
    expect(second.items.map((note) => note.title)).toEqual(['c']);
    expect(second.nextCursor).toBeNull();
  });

  it('throws NotFoundError for a missing id, never an HttpException', async () => {
    await expect(notes.get('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
