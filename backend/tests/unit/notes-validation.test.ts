/**
 * tests/unit/notes-validation.test.ts
 *
 * Implements Section 14.10, 6.6 & AC-NOTE-01: Unit tests for Notes validation schemas.
 */

import { describe, it, expect } from 'vitest';
import {
  createNoteSchema,
  updateNoteSchema,
  createNoteLinkSchema,
  listNotesQuerySchema
} from '../../src/features/notes/notes.validation.js';

describe('Notes Validation Schemas', () => {
  describe('createNoteSchema', () => {
    it('accepts note with only title', () => {
      const parsed = createNoteSchema.parse({
        title: 'Meeting Notes'
      });
      expect(parsed.title).toBe('Meeting Notes');
      expect(parsed.body).toBe('');
      expect(parsed.isPinned).toBe(false);
      expect(parsed.tags).toEqual([]);
    });

    it('accepts note with only non-empty body', () => {
      const parsed = createNoteSchema.parse({
        body: 'Some detailed content without a title'
      });
      expect(parsed.title).toBeUndefined();
      expect(parsed.body).toBe('Some detailed content without a title');
    });

    it('rejects note with empty title and empty body', () => {
      expect(() =>
        createNoteSchema.parse({
          title: '   ',
          body: ''
        })
      ).toThrow();

      expect(() =>
        createNoteSchema.parse({
          title: null,
          body: ''
        })
      ).toThrow();
    });

    it('rejects title longer than 200 characters', () => {
      expect(() =>
        createNoteSchema.parse({
          title: 'a'.repeat(201),
          body: 'Valid body'
        })
      ).toThrow(/Title cannot exceed 200 characters/);
    });

    it('rejects body longer than 100,000 characters', () => {
      expect(() =>
        createNoteSchema.parse({
          title: 'Title',
          body: 'a'.repeat(100001)
        })
      ).toThrow(/Body cannot exceed 100,000 characters/);
    });

    it('normalizes, trims, lower-cases, and deduplicates tags', () => {
      const parsed = createNoteSchema.parse({
        title: 'Notes with tags',
        tags: ['Work', 'work', '  URGENT  ', 'finance', 'Work']
      });
      expect(parsed.tags).toEqual(['work', 'urgent', 'finance']);
    });

    it('rejects tag longer than 40 characters', () => {
      expect(() =>
        createNoteSchema.parse({
          title: 'Tag test',
          tags: ['a'.repeat(41)]
        })
      ).toThrow(/Tag cannot exceed 40 characters/);
    });

    it('rejects more than 20 tags', () => {
      const tags = Array.from({ length: 21 }, (_, i) => `tag${i}`);
      expect(() =>
        createNoteSchema.parse({
          title: 'Too many tags',
          tags
        })
      ).toThrow(/Maximum 20 tags allowed/);
    });
  });

  describe('updateNoteSchema', () => {
    it('validates partial updates and normalizes tags', () => {
      const parsed = updateNoteSchema.parse({
        title: 'New Title',
        tags: ['UPDATED', 'Tag2'],
        isPinned: true,
        version: 2
      });
      expect(parsed.title).toBe('New Title');
      expect(parsed.tags).toEqual(['updated', 'tag2']);
      expect(parsed.isPinned).toBe(true);
      expect(parsed.version).toBe(2);
    });
  });

  describe('createNoteLinkSchema', () => {
    const validUuid1 = 'a0000000-0000-0000-0000-000000000001';
    const validUuid2 = 'a0000000-0000-0000-0000-000000000002';

    it('accepts single target entity (taskId)', () => {
      const parsed = createNoteLinkSchema.parse({
        taskId: validUuid1
      });
      expect(parsed.taskId).toBe(validUuid1);
      expect(parsed.projectId).toBeNull();
      expect(parsed.goalId).toBeNull();
      expect(parsed.habitId).toBeNull();
      expect(parsed.eventId).toBeNull();
    });

    it('accepts entityType and entityId pair', () => {
      const parsed = createNoteLinkSchema.parse({
        entityType: 'goal',
        entityId: validUuid1
      });
      expect(parsed.goalId).toBe(validUuid1);
      expect(parsed.taskId).toBeNull();
      expect(parsed.projectId).toBeNull();
    });

    it('rejects when multiple target entities are provided', () => {
      expect(() =>
        createNoteLinkSchema.parse({
          taskId: validUuid1,
          projectId: validUuid2
        })
      ).toThrow();
    });

    it('rejects when no target entity is provided', () => {
      expect(() =>
        createNoteLinkSchema.parse({
          taskId: null,
          projectId: null
        })
      ).toThrow();
    });
  });

  describe('listNotesQuerySchema', () => {
    it('normalizes query parameters', () => {
      const parsed = listNotesQuerySchema.parse({
        q: 'search term',
        tag: 'URGENT',
        pinned: 'true',
        linkedEntityType: 'task',
        linkedEntityId: 'a0000000-0000-0000-0000-000000000001'
      });
      expect(parsed.q).toBe('search term');
      expect(parsed.tag).toBe('urgent');
      expect(parsed.isPinned).toBe(true);
      expect(parsed.taskId).toBe('a0000000-0000-0000-0000-000000000001');
    });
  });
});
