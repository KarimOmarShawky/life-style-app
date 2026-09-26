/**
 * Note mapper unit tests.
 *
 * The mapper is where the cross-database boundary becomes visible to a client,
 * so what it does with a link whose PostgreSQL row is gone is the whole point of
 * these tests (decision DD-003).
 */
import { describe, expect, it } from 'vitest';

import { toNoteResponse } from '@/features/notes/note.mapper';
import type { NoteRecord } from '@/features/notes/note.types';

const PROJECT_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const TASK_ID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

function noteRecord(overrides: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id: '507f1f77bcf86cd799439011',
    userId: 'a1b2c3d4-0000-0000-0000-000000000000',
    projectId: null,
    taskId: null,
    title: 'Title',
    content: 'Body',
    tags: ['work'],
    isArchived: false,
    createdAt: new Date('2026-09-01T10:00:00.000Z'),
    updatedAt: new Date('2026-09-02T11:00:00.000Z'),
    ...overrides,
  };
}

describe('toNoteResponse', () => {
  it('never exposes userId', () => {
    // The response type has no such field, so this asserts the mapper is the
    // boundary rather than trusting that nobody widens the type later.
    const response = toNoteResponse(noteRecord());
    expect(Object.keys(response)).not.toContain('userId');
  });

  it('serializes timestamps as ISO strings', () => {
    const response = toNoteResponse(noteRecord());
    expect(response.createdAt).toBe('2026-09-01T10:00:00.000Z');
    expect(response.updatedAt).toBe('2026-09-02T11:00:00.000Z');
  });

  it('trusts stored links when no resolution is supplied', () => {
    // The case immediately after a write that already validated them.
    const response = toNoteResponse(noteRecord({ projectId: PROJECT_ID, taskId: TASK_ID }));
    expect(response.projectId).toBe(PROJECT_ID);
    expect(response.taskId).toBe(TASK_ID);
  });

  it('keeps a link whose row still exists', () => {
    const response = toNoteResponse(noteRecord({ projectId: PROJECT_ID }), {
      projects: new Set([PROJECT_ID]),
      tasks: new Set(),
    });
    expect(response.projectId).toBe(PROJECT_ID);
  });

  it('reports a dangling link as null', () => {
    // The task was deleted from PostgreSQL. Returning its id would hand the
    // client an id that 404s on the task endpoint.
    const response = toNoteResponse(noteRecord({ taskId: TASK_ID }), {
      projects: new Set(),
      tasks: new Set(),
    });
    expect(response.taskId).toBeNull();
  });

  it('resolves each link independently', () => {
    const response = toNoteResponse(noteRecord({ projectId: PROJECT_ID, taskId: TASK_ID }), {
      projects: new Set([PROJECT_ID]),
      tasks: new Set(),
    });
    expect(response.projectId).toBe(PROJECT_ID);
    expect(response.taskId).toBeNull();
  });
});
