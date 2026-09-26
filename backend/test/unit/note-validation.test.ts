/**
 * Note schema unit tests.
 *
 * These need no database. They cover the layer that decides what is even
 * allowed to reach MongoDB, which is where injection is stopped (spec
 * section 15).
 */
import { describe, expect, it } from 'vitest';

import { objectIdSchema } from '@/core/validation/common';
import {
  createNoteSchema,
  listNotesQuerySchema,
  updateNoteSchema,
} from '@/features/notes/note.validation';

describe('createNoteSchema', () => {
  it('accepts a minimal note', () => {
    const result = createNoteSchema.safeParse({ title: 'Groceries' });
    expect(result.success).toBe(true);
  });

  it('requires a title', () => {
    expect(createNoteSchema.safeParse({ content: 'body only' }).success).toBe(false);
  });

  it('rejects a title of only whitespace', () => {
    expect(createNoteSchema.safeParse({ title: '   ' }).success).toBe(false);
  });

  it('rejects an unknown field rather than ignoring it', () => {
    // Mass assignment: userId is the server's to decide, never the client's.
    const result = createNoteSchema.safeParse({ title: 'x', userId: 'someone-else' });
    expect(result.success).toBe(false);
  });

  it('rejects a MongoDB operator object in place of a string', () => {
    // The shape that would become { title: { $ne: null } } in a query.
    const result = createNoteSchema.safeParse({ title: { $ne: null } });
    expect(result.success).toBe(false);
  });

  it('rejects an operator object smuggled inside tags', () => {
    const result = createNoteSchema.safeParse({ title: 'x', tags: [{ $gt: '' }] });
    expect(result.success).toBe(false);
  });

  it('lowercases and deduplicates tags', () => {
    const result = createNoteSchema.parse({ title: 'x', tags: ['Work', 'work', 'WORK', 'Home'] });
    expect(result.tags).toEqual(['work', 'home']);
  });

  it('counts tags after deduplication', () => {
    // 30 copies of one tag is one tag, not 30.
    const result = createNoteSchema.safeParse({ title: 'x', tags: Array(30).fill('same') });
    expect(result.success).toBe(true);
  });

  it('rejects more than 25 distinct tags', () => {
    const tags = Array.from({ length: 26 }, (_, index) => `tag-${index}`);
    expect(createNoteSchema.safeParse({ title: 'x', tags }).success).toBe(false);
  });

  it('rejects content beyond the cap', () => {
    const result = createNoteSchema.safeParse({ title: 'x', content: 'a'.repeat(100_001) });
    expect(result.success).toBe(false);
  });

  it('preserves leading whitespace in content', () => {
    // Indentation in a note body is typed on purpose, unlike a stray space in a title.
    const result = createNoteSchema.parse({ title: 'x', content: '    indented' });
    expect(result.content).toBe('    indented');
  });

  it('accepts null links to mean unlinked', () => {
    const result = createNoteSchema.safeParse({ title: 'x', projectId: null, taskId: null });
    expect(result.success).toBe(true);
  });

  it('rejects a link that is not a UUID', () => {
    expect(createNoteSchema.safeParse({ title: 'x', projectId: 'not-a-uuid' }).success).toBe(false);
  });
});

describe('updateNoteSchema', () => {
  it('rejects an empty patch', () => {
    // An empty PATCH is nearly always a client bug; answering 200 hides it.
    expect(updateNoteSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a single field', () => {
    expect(updateNoteSchema.safeParse({ isArchived: true }).success).toBe(true);
  });

  it('accepts null to clear a link', () => {
    expect(updateNoteSchema.safeParse({ taskId: null }).success).toBe(true);
  });

  it('rejects a non-boolean isArchived', () => {
    expect(updateNoteSchema.safeParse({ isArchived: 'yes' }).success).toBe(false);
  });
});

describe('listNotesQuerySchema', () => {
  it('defaults archived to false', () => {
    const result = listNotesQuerySchema.parse({});
    expect(result.archived).toBe(false);
  });

  it('reads archived=true', () => {
    expect(listNotesQuerySchema.parse({ archived: 'true' }).archived).toBe(true);
  });

  it('rejects an archived value that is neither true nor false', () => {
    expect(listNotesQuerySchema.safeParse({ archived: 'maybe' }).success).toBe(false);
  });

  it('lowercases a tag filter so it matches stored tags', () => {
    expect(listNotesQuerySchema.parse({ tag: 'Work' }).tag).toBe('work');
  });

  it('rejects an unknown query parameter', () => {
    // Silently ignoring it would return every note to a client that believes
    // it filtered.
    expect(listNotesQuerySchema.safeParse({ colour: 'red' }).success).toBe(false);
  });

  it('rejects a limit above the maximum', () => {
    expect(listNotesQuerySchema.safeParse({ limit: '999999999' }).success).toBe(false);
  });
});

describe('objectIdSchema', () => {
  it('accepts a 24-character hex id', () => {
    expect(objectIdSchema.safeParse('507f1f77bcf86cd799439011').success).toBe(true);
  });

  it('rejects a UUID', () => {
    // Notes are not PostgreSQL rows; accepting a UUID here would reach the
    // driver and throw rather than returning a clean 422.
    expect(objectIdSchema.safeParse('3f2504e0-4f89-11d3-9a0c-0305e82c3301').success).toBe(false);
  });

  it('rejects a short or non-hex id', () => {
    expect(objectIdSchema.safeParse('abc').success).toBe(false);
    expect(objectIdSchema.safeParse('zzzzzzzzzzzzzzzzzzzzzzzz').success).toBe(false);
  });
});
