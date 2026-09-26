/**
 * Resource-level security tests for notes (spec sections 15, 16, 41, 57).
 *
 * Same scenario as resource-access.test.ts: Mallory is a fully authenticated,
 * legitimate user who simply asks for Alice's identifiers. Notes raise two
 * questions the PostgreSQL resources did not:
 *
 *   1. Ownership is enforced by a MongoDB filter rather than a SQL WHERE clause.
 *      A missed `userId` there is invisible until someone looks for it.
 *   2. The query language is JSON, so a body or query value that survives
 *      validation as an object becomes an operator rather than a value.
 *
 * SKIPPED when MONGODB_URI is unset. That is a real gap, not a pass: these are
 * the tests that prove the isolation claim, and they need a database to prove it
 * against.
 */
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

import { createApp } from '@/app';

import { MONGO_CONFIGURED, STRONG_PASSWORD, testEmail } from '../setup';

let app: Express;
let alice: string;
let mallory: string;

let aliceNoteId: string;
let aliceProjectId: string;
let aliceTaskId: string;

/** A well-formed ObjectId that has never been issued. */
const INVENTED_NOTE_ID = '507f1f77bcf86cd799439011';

async function tokenFor(label: string): Promise<string> {
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: testEmail(label), password: STRONG_PASSWORD })
    .expect(201);
  return `Bearer ${response.body.data.tokens.accessToken}`;
}

describe.skipIf(!MONGO_CONFIGURED)('note access control', () => {
  beforeAll(async () => {
    app = createApp();
    alice = await tokenFor('note-idor-alice');
    mallory = await tokenFor('note-idor-mallory');

    const project = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', alice)
      .send({ name: 'Alice project' })
      .expect(201);
    aliceProjectId = project.body.data.id;

    const task = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', alice)
      .send({ title: 'Alice task' })
      .expect(201);
    aliceTaskId = task.body.data.id;

    const note = await request(app)
      .post('/api/v1/notes')
      .set('Authorization', alice)
      .send({
        title: 'Alice private note',
        content: 'bank details and other secrets',
        tags: ['alice-secret'],
        projectId: aliceProjectId,
        taskId: aliceTaskId,
      })
      .expect(201);
    aliceNoteId = note.body.data.id;
  });

  describe('direct object references', () => {
    it('hides another user note from GET', async () => {
      await request(app)
        .get(`/api/v1/notes/${aliceNoteId}`)
        .set('Authorization', mallory)
        .expect(404);
    });

    it('hides another user note from PATCH', async () => {
      await request(app)
        .patch(`/api/v1/notes/${aliceNoteId}`)
        .set('Authorization', mallory)
        .send({ title: 'Owned by Mallory now' })
        .expect(404);
    });

    it('hides another user note from DELETE', async () => {
      await request(app)
        .delete(`/api/v1/notes/${aliceNoteId}`)
        .set('Authorization', mallory)
        .expect(404);
    });

    it('answers identically for a real foreign id and an invented one', async () => {
      // Any difference here is an oracle for which ids exist.
      const foreign = await request(app)
        .get(`/api/v1/notes/${aliceNoteId}`)
        .set('Authorization', mallory)
        .expect(404);

      const invented = await request(app)
        .get(`/api/v1/notes/${INVENTED_NOTE_ID}`)
        .set('Authorization', mallory)
        .expect(404);

      expect(foreign.body.error.code).toBe(invented.body.error.code);
      expect(foreign.body.error.message).toBe(invented.body.error.message);
    });

    it('leaks no content of the note it refuses to return', async () => {
      const response = await request(app)
        .get(`/api/v1/notes/${aliceNoteId}`)
        .set('Authorization', mallory)
        .expect(404);

      const body = JSON.stringify(response.body);
      expect(body).not.toContain('bank details');
      expect(body).not.toContain('Alice private note');
      expect(body).not.toContain('alice-secret');
    });

    it('leaves the note intact after every failed attempt', async () => {
      const response = await request(app)
        .get(`/api/v1/notes/${aliceNoteId}`)
        .set('Authorization', alice)
        .expect(200);

      expect(response.body.data.title).toBe('Alice private note');
      expect(response.body.data.isArchived).toBe(false);
    });
  });

  describe('filters cannot widen access', () => {
    it('returns nothing when filtering by another user task', async () => {
      const response = await request(app)
        .get(`/api/v1/notes?taskId=${aliceTaskId}`)
        .set('Authorization', mallory)
        .expect(200);

      expect(response.body.data).toEqual([]);
    });

    it('returns nothing when filtering by another user project', async () => {
      const response = await request(app)
        .get(`/api/v1/notes?projectId=${aliceProjectId}`)
        .set('Authorization', mallory)
        .expect(200);

      expect(response.body.data).toEqual([]);
    });

    it('does not surface another user tags through search', async () => {
      const response = await request(app)
        .get('/api/v1/notes?search=bank%20details')
        .set('Authorization', mallory)
        .expect(200);

      expect(response.body.data).toEqual([]);
    });

    it('does not surface another user tags through the tags endpoint', async () => {
      const response = await request(app)
        .get('/api/v1/notes/tags')
        .set('Authorization', mallory)
        .expect(200);

      expect(response.body.data).not.toContain('alice-secret');
    });
  });

  describe('cross-database links cannot cross users', () => {
    it('refuses to attach a note to another user project', async () => {
      await request(app)
        .post('/api/v1/notes')
        .set('Authorization', mallory)
        .send({ title: 'Stolen link', projectId: aliceProjectId })
        .expect(422);
    });

    it('refuses to attach a note to another user task', async () => {
      await request(app)
        .post('/api/v1/notes')
        .set('Authorization', mallory)
        .send({ title: 'Stolen link', taskId: aliceTaskId })
        .expect(422);
    });

    it('answers identically for a foreign project and a nonexistent one', async () => {
      const foreign = await request(app)
        .post('/api/v1/notes')
        .set('Authorization', mallory)
        .send({ title: 'Probe', projectId: aliceProjectId })
        .expect(422);

      const invented = await request(app)
        .post('/api/v1/notes')
        .set('Authorization', mallory)
        .send({ title: 'Probe', projectId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' })
        .expect(422);

      expect(JSON.stringify(foreign.body.error.issues)).toBe(
        JSON.stringify(invented.body.error.issues),
      );
    });

    it('refuses to attach an existing note to another user task', async () => {
      const own = await request(app)
        .post('/api/v1/notes')
        .set('Authorization', mallory)
        .send({ title: 'Mallory own note' })
        .expect(201);

      await request(app)
        .patch(`/api/v1/notes/${own.body.data.id}`)
        .set('Authorization', mallory)
        .send({ taskId: aliceTaskId })
        .expect(422);
    });

    it('does not let reconciliation touch another user notes', async () => {
      await request(app).post('/api/v1/notes/reconcile').set('Authorization', mallory).expect(200);

      const response = await request(app)
        .get(`/api/v1/notes/${aliceNoteId}`)
        .set('Authorization', alice)
        .expect(200);

      // Alice's links are live, and another user's reconciliation must not
      // consider them at all.
      expect(response.body.data.projectId).toBe(aliceProjectId);
      expect(response.body.data.taskId).toBe(aliceTaskId);
    });
  });

  describe('query injection', () => {
    it('rejects an operator object where a title belongs', async () => {
      await request(app)
        .post('/api/v1/notes')
        .set('Authorization', mallory)
        .send({ title: { $ne: null } })
        .expect(422);
    });

    it('rejects an operator object in a list filter', async () => {
      // Express parses ?tag[$ne]= into an object. Validation must reject it
      // rather than passing it through as a query operator.
      await request(app).get('/api/v1/notes?tag[$ne]=').set('Authorization', mallory).expect(422);
    });

    it('rejects an attempt to set the owner directly', async () => {
      await request(app)
        .post('/api/v1/notes')
        .set('Authorization', mallory)
        .send({ title: 'Mass assignment', userId: '00000000-0000-0000-0000-000000000000' })
        .expect(422);
    });

    it('rejects an attempt to set the id directly', async () => {
      await request(app)
        .post('/api/v1/notes')
        .set('Authorization', mallory)
        .send({ title: 'Chosen id', _id: INVENTED_NOTE_ID })
        .expect(422);
    });

    it('treats a regular-expression payload in search as literal text', async () => {
      // ".*" would match every note if it reached the driver unescaped.
      const response = await request(app)
        .get(`/api/v1/notes?search=${encodeURIComponent('.*')}`)
        .set('Authorization', mallory)
        .expect(200);

      expect(response.body.data).toEqual([]);
    });

    it('answers a catastrophic backtracking payload promptly', async () => {
      const started = Date.now();
      await request(app)
        .get(`/api/v1/notes?search=${encodeURIComponent('(a+)+$')}`)
        .set('Authorization', mallory)
        .expect(200);

      expect(Date.now() - started).toBeLessThan(5000);
    });
  });

  describe('authentication', () => {
    it('requires a token on every note route', async () => {
      await request(app).get('/api/v1/notes').expect(401);
      await request(app).post('/api/v1/notes').send({ title: 'x' }).expect(401);
      await request(app).get(`/api/v1/notes/${aliceNoteId}`).expect(401);
      await request(app).patch(`/api/v1/notes/${aliceNoteId}`).send({ title: 'x' }).expect(401);
      await request(app).delete(`/api/v1/notes/${aliceNoteId}`).expect(401);
      await request(app).get('/api/v1/notes/tags').expect(401);
      await request(app).post('/api/v1/notes/reconcile').expect(401);
    });

    it('rejects a token with a tampered signature', async () => {
      const tampered = `${mallory.slice(0, -1)}${mallory.endsWith('A') ? 'B' : 'A'}`;
      await request(app).get('/api/v1/notes').set('Authorization', tampered).expect(401);
    });
  });
});
