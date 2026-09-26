/**
 * Integration tests for notes (spec sections 8 and 41).
 *
 * These are the only tests in the suite that touch both databases in one
 * request, which is the point: a note lives in MongoDB and links to rows in
 * PostgreSQL, and nothing enforces that relationship except the code under test.
 *
 * SKIPPED when MONGODB_URI is unset, so the suite stays green for a developer
 * who has not provisioned MongoDB. The companion file notes-unavailable.test.ts
 * runs in that case instead and asserts the degraded behaviour.
 */
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

import { createApp } from '@/app';

import { MONGO_CONFIGURED, STRONG_PASSWORD, testEmail } from '../setup';

let app: Express;
let auth: string;
let projectId: string;
let taskId: string;

interface Envelope<T> {
  success: boolean;
  data: T;
  pagination?: { nextCursor: string | null; hasMore: boolean };
}

interface Note {
  id: string;
  projectId: string | null;
  taskId: string | null;
  title: string;
  content: string;
  tags: string[];
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

async function tokenFor(label: string): Promise<string> {
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: testEmail(label), password: STRONG_PASSWORD })
    .expect(201);
  return `Bearer ${response.body.data.tokens.accessToken}`;
}

async function createNote(header: string, body: Record<string, unknown>): Promise<Note> {
  const response = await request(app)
    .post('/api/v1/notes')
    .set('Authorization', header)
    .send(body)
    .expect(201);
  return (response.body as Envelope<Note>).data;
}

describe.skipIf(!MONGO_CONFIGURED)('notes', () => {
  beforeAll(async () => {
    app = createApp();
    auth = await tokenFor('notes');

    const project = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', auth)
      .send({ name: 'Notes project' })
      .expect(201);
    projectId = project.body.data.id;

    const task = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', auth)
      .send({ title: 'Notes task' })
      .expect(201);
    taskId = task.body.data.id;
  });

  describe('creation', () => {
    it('creates a note with only a title', async () => {
      const note = await createNote(auth, { title: 'Shopping list' });

      expect(note.id).toMatch(/^[0-9a-f]{24}$/);
      expect(note.content).toBe('');
      expect(note.tags).toEqual([]);
      expect(note.isArchived).toBe(false);
      expect(note.projectId).toBeNull();
      expect(note.taskId).toBeNull();
    });

    it('stores tags lowercased and deduplicated', async () => {
      const note = await createNote(auth, {
        title: 'Tagged',
        tags: ['Work', 'work', 'Urgent'],
      });
      expect(note.tags).toEqual(['work', 'urgent']);
    });

    it('links a note to a project and a task the caller owns', async () => {
      const note = await createNote(auth, { title: 'Linked', projectId, taskId });
      expect(note.projectId).toBe(projectId);
      expect(note.taskId).toBe(taskId);
    });

    it('never publishes the owner id', async () => {
      const note = await createNote(auth, { title: 'No owner field' });
      expect(note).not.toHaveProperty('userId');
    });

    it('preserves a long body verbatim', async () => {
      const content = 'line one\n\n    indented line\n\ttabbed';
      const note = await createNote(auth, { title: 'Formatting', content });
      expect(note.content).toBe(content);
    });

    it('rejects a project id that is not a UUID', async () => {
      await request(app)
        .post('/api/v1/notes')
        .set('Authorization', auth)
        .send({ title: 'Bad link', projectId: 'nope' })
        .expect(422);
    });

    it('rejects an unknown field instead of storing it', async () => {
      await request(app)
        .post('/api/v1/notes')
        .set('Authorization', auth)
        .send({ title: 'Injected', userId: '00000000-0000-0000-0000-000000000000' })
        .expect(422);
    });
  });

  describe('reading', () => {
    it('returns a note by id', async () => {
      const created = await createNote(auth, { title: 'Readable', content: 'body' });

      const response = await request(app)
        .get(`/api/v1/notes/${created.id}`)
        .set('Authorization', auth)
        .expect(200);

      expect((response.body as Envelope<Note>).data.title).toBe('Readable');
    });

    it('returns 404 for a well-formed id that does not exist', async () => {
      await request(app)
        .get('/api/v1/notes/507f1f77bcf86cd799439011')
        .set('Authorization', auth)
        .expect(404);
    });

    it('returns 422 for an id that is not an ObjectId', async () => {
      // A UUID is well-formed for every other resource in this API and is still
      // wrong here, so it must fail cleanly rather than reaching the driver.
      await request(app)
        .get('/api/v1/notes/3f2504e0-4f89-11d3-9a0c-0305e82c3301')
        .set('Authorization', auth)
        .expect(422);
    });
  });

  describe('listing and filtering', () => {
    it('filters by tag', async () => {
      const tag = `filter-${Date.now()}`;
      await createNote(auth, { title: 'Tagged for filter', tags: [tag] });
      await createNote(auth, { title: 'Untagged' });

      const response = await request(app)
        .get(`/api/v1/notes?tag=${tag}`)
        .set('Authorization', auth)
        .expect(200);

      const notes = (response.body as Envelope<Note[]>).data;
      expect(notes).toHaveLength(1);
      expect(notes[0]?.title).toBe('Tagged for filter');
    });

    it('matches a tag filter regardless of the case it was typed in', async () => {
      const tag = `case-${Date.now()}`;
      await createNote(auth, { title: 'Case test', tags: [tag.toUpperCase()] });

      const response = await request(app)
        .get(`/api/v1/notes?tag=${tag.toUpperCase()}`)
        .set('Authorization', auth)
        .expect(200);

      expect((response.body as Envelope<Note[]>).data).toHaveLength(1);
    });

    it('searches title and content as a substring', async () => {
      const marker = `srch${Date.now()}`;
      await createNote(auth, { title: `Title with ${marker}` });
      await createNote(auth, { title: 'Other', content: `body mentions ${marker} here` });

      const response = await request(app)
        .get(`/api/v1/notes?search=${marker}`)
        .set('Authorization', auth)
        .expect(200);

      expect((response.body as Envelope<Note[]>).data).toHaveLength(2);
    });

    it('searches case-insensitively and on a partial word', async () => {
      const marker = `Partial${Date.now()}`;
      await createNote(auth, { title: `${marker} full word` });

      const response = await request(app)
        .get(`/api/v1/notes?search=${marker.slice(0, 7).toLowerCase()}`)
        .set('Authorization', auth)
        .expect(200);

      expect((response.body as Envelope<Note[]>).data.length).toBeGreaterThanOrEqual(1);
    });

    it('treats a regular-expression metacharacter in a search as literal text', async () => {
      await createNote(auth, { title: 'Learning c++ basics' });

      const response = await request(app)
        .get(`/api/v1/notes?search=${encodeURIComponent('c++')}`)
        .set('Authorization', auth)
        .expect(200);

      const notes = (response.body as Envelope<Note[]>).data;
      expect(notes.every((note) => note.title.includes('c++'))).toBe(true);
    });

    it('filters by linked task', async () => {
      await createNote(auth, { title: 'Attached to task', taskId });

      const response = await request(app)
        .get(`/api/v1/notes?taskId=${taskId}`)
        .set('Authorization', auth)
        .expect(200);

      const notes = (response.body as Envelope<Note[]>).data;
      expect(notes.length).toBeGreaterThanOrEqual(1);
      expect(notes.every((note) => note.taskId === taskId)).toBe(true);
    });

    it('rejects an unknown query parameter', async () => {
      await request(app).get('/api/v1/notes?colour=red').set('Authorization', auth).expect(422);
    });

    it('pages without overlap or gaps', async () => {
      const header = await tokenFor('notes-paging');
      for (let index = 0; index < 5; index += 1) {
        await createNote(header, { title: `Paged ${index}` });
      }

      const first = await request(app)
        .get('/api/v1/notes?limit=2')
        .set('Authorization', header)
        .expect(200);

      const firstPage = first.body as Envelope<Note[]>;
      expect(firstPage.data).toHaveLength(2);
      expect(firstPage.pagination?.hasMore).toBe(true);

      const second = await request(app)
        .get(
          `/api/v1/notes?limit=2&cursor=${encodeURIComponent(firstPage.pagination?.nextCursor ?? '')}`,
        )
        .set('Authorization', header)
        .expect(200);

      const secondPage = second.body as Envelope<Note[]>;
      const firstIds = firstPage.data.map((note) => note.id);
      const secondIds = secondPage.data.map((note) => note.id);

      expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
    });
  });

  describe('archiving', () => {
    it('hides an archived note from the default listing and shows it under archived=true', async () => {
      const header = await tokenFor('notes-archive');
      const note = await createNote(header, { title: 'To archive' });

      await request(app)
        .patch(`/api/v1/notes/${note.id}`)
        .set('Authorization', header)
        .send({ isArchived: true })
        .expect(200);

      const live = await request(app).get('/api/v1/notes').set('Authorization', header).expect(200);
      expect((live.body as Envelope<Note[]>).data).toHaveLength(0);

      const archived = await request(app)
        .get('/api/v1/notes?archived=true')
        .set('Authorization', header)
        .expect(200);
      expect((archived.body as Envelope<Note[]>).data).toHaveLength(1);
    });
  });

  describe('updating', () => {
    it('replaces tags rather than merging them', async () => {
      const note = await createNote(auth, { title: 'Retag', tags: ['one', 'two'] });

      const response = await request(app)
        .patch(`/api/v1/notes/${note.id}`)
        .set('Authorization', auth)
        .send({ tags: ['three'] })
        .expect(200);

      expect((response.body as Envelope<Note>).data.tags).toEqual(['three']);
    });

    it('clears a link when null is sent', async () => {
      const note = await createNote(auth, { title: 'Unlink me', projectId });

      const response = await request(app)
        .patch(`/api/v1/notes/${note.id}`)
        .set('Authorization', auth)
        .send({ projectId: null })
        .expect(200);

      expect((response.body as Envelope<Note>).data.projectId).toBeNull();
    });

    it('leaves a link alone when the field is absent', async () => {
      const note = await createNote(auth, { title: 'Keep link', projectId });

      const response = await request(app)
        .patch(`/api/v1/notes/${note.id}`)
        .set('Authorization', auth)
        .send({ title: 'Renamed' })
        .expect(200);

      expect((response.body as Envelope<Note>).data.projectId).toBe(projectId);
    });

    it('rejects an empty patch', async () => {
      const note = await createNote(auth, { title: 'No-op patch' });

      await request(app)
        .patch(`/api/v1/notes/${note.id}`)
        .set('Authorization', auth)
        .send({})
        .expect(422);
    });

    it('moves updatedAt forward', async () => {
      const note = await createNote(auth, { title: 'Timestamps' });

      const response = await request(app)
        .patch(`/api/v1/notes/${note.id}`)
        .set('Authorization', auth)
        .send({ title: 'Timestamps changed' })
        .expect(200);

      const updated = (response.body as Envelope<Note>).data;
      expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(note.updatedAt));
    });
  });

  describe('deletion', () => {
    it('deletes a note and then reports it missing', async () => {
      const note = await createNote(auth, { title: 'Delete me' });

      await request(app).delete(`/api/v1/notes/${note.id}`).set('Authorization', auth).expect(204);

      await request(app).get(`/api/v1/notes/${note.id}`).set('Authorization', auth).expect(404);
    });

    it('returns 404 when deleting twice', async () => {
      const note = await createNote(auth, { title: 'Delete twice' });

      await request(app).delete(`/api/v1/notes/${note.id}`).set('Authorization', auth).expect(204);
      await request(app).delete(`/api/v1/notes/${note.id}`).set('Authorization', auth).expect(404);
    });
  });

  describe('tags endpoint', () => {
    it('lists the caller distinct tags in order', async () => {
      const header = await tokenFor('notes-tags');
      await createNote(header, { title: 'A', tags: ['zebra', 'apple'] });
      await createNote(header, { title: 'B', tags: ['apple', 'mango'] });

      const response = await request(app)
        .get('/api/v1/notes/tags')
        .set('Authorization', header)
        .expect(200);

      expect((response.body as Envelope<string[]>).data).toEqual(['apple', 'mango', 'zebra']);
    });

    it('is not shadowed by the :id route', async () => {
      // "tags" is not an ObjectId. If route order were wrong this would be 422.
      const header = await tokenFor('notes-tags-order');
      await request(app).get('/api/v1/notes/tags').set('Authorization', header).expect(200);
    });
  });

  describe('the cross-database boundary', () => {
    it('refuses to link a note to a project that does not exist', async () => {
      await request(app)
        .post('/api/v1/notes')
        .set('Authorization', auth)
        .send({ title: 'Ghost link', projectId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' })
        .expect(422);
    });

    it('reports a link as null once its task is deleted', async () => {
      const header = await tokenFor('notes-dangling');

      const task = await request(app)
        .post('/api/v1/tasks')
        .set('Authorization', header)
        .send({ title: 'Doomed task' })
        .expect(201);
      const doomedTaskId = task.body.data.id as string;

      const note = await createNote(header, { title: 'Linked to doomed', taskId: doomedTaskId });
      expect(note.taskId).toBe(doomedTaskId);

      await request(app)
        .delete(`/api/v1/tasks/${doomedTaskId}`)
        .set('Authorization', header)
        .expect(204);

      // There is no cascade across the boundary. The stored id is still there;
      // the read must not hand the client an id that 404s.
      const response = await request(app)
        .get(`/api/v1/notes/${note.id}`)
        .set('Authorization', header)
        .expect(200);

      expect((response.body as Envelope<Note>).data.taskId).toBeNull();
    });

    it('clears dangling links on reconciliation and is idempotent', async () => {
      const header = await tokenFor('notes-reconcile');

      const task = await request(app)
        .post('/api/v1/tasks')
        .set('Authorization', header)
        .send({ title: 'Also doomed' })
        .expect(201);
      const doomedTaskId = task.body.data.id as string;

      await createNote(header, { title: 'Reconcile me', taskId: doomedTaskId });

      await request(app)
        .delete(`/api/v1/tasks/${doomedTaskId}`)
        .set('Authorization', header)
        .expect(204);

      const first = await request(app)
        .post('/api/v1/notes/reconcile')
        .set('Authorization', header)
        .expect(200);

      expect((first.body as Envelope<{ taskLinksCleared: number }>).data.taskLinksCleared).toBe(1);

      // Running it again finds nothing left to do.
      const second = await request(app)
        .post('/api/v1/notes/reconcile')
        .set('Authorization', header)
        .expect(200);

      expect((second.body as Envelope<{ taskLinksCleared: number }>).data.taskLinksCleared).toBe(0);
    });

    it('leaves a live link untouched during reconciliation', async () => {
      const header = await tokenFor('notes-reconcile-safe');

      const task = await request(app)
        .post('/api/v1/tasks')
        .set('Authorization', header)
        .send({ title: 'Healthy task' })
        .expect(201);
      const liveTaskId = task.body.data.id as string;

      const note = await createNote(header, { title: 'Healthy link', taskId: liveTaskId });

      await request(app).post('/api/v1/notes/reconcile').set('Authorization', header).expect(200);

      const response = await request(app)
        .get(`/api/v1/notes/${note.id}`)
        .set('Authorization', header)
        .expect(200);

      expect((response.body as Envelope<Note>).data.taskId).toBe(liveTaskId);
    });
  });
});
