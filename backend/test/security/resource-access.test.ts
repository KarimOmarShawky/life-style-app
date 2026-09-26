/**
 * Resource-level security tests (spec sections 16, 41, 57).
 *
 * These are the tests the auth suite could not provide: until a user-owned
 * resource existed there was nothing to attack with a guessed identifier.
 *
 * The scenario throughout: Mallory is a fully authenticated, legitimate user.
 * She is not an outsider. She simply asks for Alice's identifiers. Every such
 * request must be indistinguishable from asking for something that never
 * existed.
 */
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

import { createApp } from '@/app';

import { STRONG_PASSWORD, testEmail } from '../setup';

let app: Express;
let alice: string;
let mallory: string;

let aliceProjectId: string;
let aliceTaskId: string;
let aliceTimedTaskId: string;

async function tokenFor(label: string): Promise<string> {
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: testEmail(label), password: STRONG_PASSWORD })
    .expect(201);
  return `Bearer ${response.body.data.tokens.accessToken}`;
}

beforeAll(async () => {
  app = createApp();
  alice = await tokenFor('idor-alice');
  mallory = await tokenFor('idor-mallory');

  const project = await request(app)
    .post('/api/v1/projects')
    .set('Authorization', alice)
    .send({ name: 'Alice private project' })
    .expect(201);
  aliceProjectId = project.body.data.id;

  const task = await request(app)
    .post('/api/v1/tasks')
    .set('Authorization', alice)
    .send({ title: 'Alice private task', projectId: aliceProjectId })
    .expect(201);
  aliceTaskId = task.body.data.id;

  const timed = await request(app)
    .post('/api/v1/tasks')
    .set('Authorization', alice)
    .send({ title: 'Alice timed task', hasTimer: true })
    .expect(201);
  aliceTimedTaskId = timed.body.data.id;
});

describe('IDOR and BOLA on tasks (spec section 16)', () => {
  it('hides another user task from every read and write verb', async () => {
    await request(app)
      .get(`/api/v1/tasks/${aliceTaskId}`)
      .set('Authorization', mallory)
      .expect(404);

    await request(app)
      .patch(`/api/v1/tasks/${aliceTaskId}`)
      .set('Authorization', mallory)
      .send({ title: 'hijacked' })
      .expect(404);

    await request(app)
      .delete(`/api/v1/tasks/${aliceTaskId}`)
      .set('Authorization', mallory)
      .expect(404);
  });

  it('returns 404 rather than 403, so real ids cannot be told from fake ones', async () => {
    // The whole enumeration defence rests on these two being identical.
    const real = await request(app)
      .get(`/api/v1/tasks/${aliceTaskId}`)
      .set('Authorization', mallory)
      .expect(404);

    const invented = await request(app)
      .get('/api/v1/tasks/6f1e2d3c-4b5a-4c7d-8e9f-0a1b2c3d4e5f')
      .set('Authorization', mallory)
      .expect(404);

    expect(real.body.error.code).toBe(invented.body.error.code);
    expect(real.body.error.message).toBe(invented.body.error.message);
  });

  it('leaks nothing about the task in the error body', async () => {
    const response = await request(app)
      .get(`/api/v1/tasks/${aliceTaskId}`)
      .set('Authorization', mallory)
      .expect(404);

    const body = JSON.stringify(response.body);
    expect(body).not.toContain('Alice private task');
    expect(body).not.toContain('ownedBy');
    expect(body).not.toContain('requestedBy');
  });

  it("does not list another user's tasks", async () => {
    const response = await request(app)
      .get('/api/v1/tasks?limit=100')
      .set('Authorization', mallory)
      .expect(200);

    const ids = (response.body.data as { id: string }[]).map((t) => t.id);
    expect(ids).not.toContain(aliceTaskId);
  });

  it("cannot reach another user's tasks by filtering on their project id", async () => {
    // A filter must never widen access beyond the owner predicate.
    const response = await request(app)
      .get(`/api/v1/tasks?projectId=${aliceProjectId}&limit=100`)
      .set('Authorization', mallory)
      .expect(200);

    expect(response.body.data).toHaveLength(0);
  });

  it('leaves the real task untouched after every attempt', async () => {
    const response = await request(app)
      .get(`/api/v1/tasks/${aliceTaskId}`)
      .set('Authorization', alice)
      .expect(200);

    expect(response.body.data.title).toBe('Alice private task');
  });
});

describe('IDOR on projects', () => {
  it('hides another user project from read, update and delete', async () => {
    await request(app)
      .get(`/api/v1/projects/${aliceProjectId}`)
      .set('Authorization', mallory)
      .expect(404);

    await request(app)
      .patch(`/api/v1/projects/${aliceProjectId}`)
      .set('Authorization', mallory)
      .send({ name: 'hijacked' })
      .expect(404);

    await request(app)
      .delete(`/api/v1/projects/${aliceProjectId}`)
      .set('Authorization', mallory)
      .expect(404);
  });

  it("refuses to file a task under another user's project", async () => {
    // Cross-entity ownership: the reference itself must be authorized, not just
    // the resource being created.
    const response = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', mallory)
      .send({ title: 'Trojan task', projectId: aliceProjectId })
      .expect(422);

    expect(response.body.error.issues[0].field).toBe('projectId');
  });

  it("refuses to move an owned task into another user's project", async () => {
    const own = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', mallory)
      .send({ title: 'Mallory task' })
      .expect(201);

    await request(app)
      .patch(`/api/v1/tasks/${own.body.data.id}`)
      .set('Authorization', mallory)
      .send({ projectId: aliceProjectId })
      .expect(422);
  });

  it('gives the same answer for a real foreign project and an invented one', async () => {
    const foreign = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', mallory)
      .send({ title: 'probe a', projectId: aliceProjectId })
      .expect(422);

    const invented = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', mallory)
      .send({ title: 'probe b', projectId: '6f1e2d3c-4b5a-4c7d-8e9f-0a1b2c3d4e5f' })
      .expect(422);

    expect(foreign.body.error.issues[0].message).toBe(invented.body.error.issues[0].message);
  });
});

describe('IDOR on timer sessions', () => {
  it("cannot start, stop or read another user's timer", async () => {
    await request(app)
      .post(`/api/v1/tasks/${aliceTimedTaskId}/timer/start`)
      .set('Authorization', mallory)
      .expect(404);

    await request(app)
      .post(`/api/v1/tasks/${aliceTimedTaskId}/timer/stop`)
      .set('Authorization', mallory)
      .expect(404);

    await request(app)
      .get(`/api/v1/tasks/${aliceTimedTaskId}/timer/sessions`)
      .set('Authorization', mallory)
      .expect(404);
  });

  it("a foreign stop attempt does not end the owner's running timer", async () => {
    // The dangerous version of this bug is silent: the request appears to fail
    // while still having mutated the victim's row.
    await request(app)
      .post(`/api/v1/tasks/${aliceTimedTaskId}/timer/start`)
      .set('Authorization', alice)
      .expect(200);

    await request(app)
      .post(`/api/v1/tasks/${aliceTimedTaskId}/timer/stop`)
      .set('Authorization', mallory)
      .expect(404);

    const check = await request(app)
      .get(`/api/v1/tasks/${aliceTimedTaskId}`)
      .set('Authorization', alice)
      .expect(200);

    expect(check.body.data.isTimerRunning).toBe(true);

    await request(app)
      .post(`/api/v1/tasks/${aliceTimedTaskId}/timer/stop`)
      .set('Authorization', alice)
      .expect(200);
  });
});

describe('Mass assignment on task and project writes (spec section 45)', () => {
  it('refuses a userId injected into a task body', async () => {
    await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', mallory)
      .send({ title: 'Reassign me', userId: '00000000-0000-4000-8000-000000000000' })
      .expect(422);
  });

  it('refuses a client-supplied completedAt', async () => {
    // completedAt is derived from status by the server. Accepting it would let a
    // client write an inconsistent pair that the database constraint rejects.
    await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', mallory)
      .send({ title: 'Fake completion', completedAt: '2020-01-01T00:00:00Z' })
      .expect(422);
  });

  it('refuses an injected id on create', async () => {
    await request(app)
      .post('/api/v1/projects')
      .set('Authorization', mallory)
      .send({ name: 'Chosen id', id: '6f1e2d3c-4b5a-4c7d-8e9f-0a1b2c3d4e5f' })
      .expect(422);
  });
});

describe('Injection through task filters (spec section 14)', () => {
  it('treats SQL metacharacters in search as literal text', async () => {
    const response = await request(app)
      .get(`/api/v1/tasks?search=${encodeURIComponent("' OR 1=1--")}&limit=100`)
      .set('Authorization', mallory)
      .expect(200);

    // If the fragment were interpolated, this would return every row.
    expect(response.body.data).toHaveLength(0);
  });

  it('treats LIKE wildcards in search as literal characters', async () => {
    // Unescaped, "%" would match every title and turn search into a full dump.
    const response = await request(app)
      .get('/api/v1/tasks?search=%25&limit=100')
      .set('Authorization', mallory)
      .expect(200);

    expect(response.body.data).toHaveLength(0);
  });

  it('rejects a non-UUID project filter rather than passing it to the database', async () => {
    await request(app)
      .get('/api/v1/tasks?projectId=1%20OR%201%3D1&limit=10')
      .set('Authorization', mallory)
      .expect(422);
  });

  it('rejects an unexpected sort or filter key', async () => {
    await request(app)
      .get('/api/v1/tasks?orderBy=password_hash&limit=10')
      .set('Authorization', mallory)
      .expect(422);
  });
});

describe('Authentication is required for every resource route', () => {
  const routes: readonly [string, string][] = [
    ['get', '/api/v1/tasks'],
    ['post', '/api/v1/tasks'],
    ['get', '/api/v1/projects'],
    ['post', '/api/v1/projects'],
  ];

  it.each(routes)('%s %s rejects an anonymous caller', async (method, path) => {
    const agent = request(app);
    const call = method === 'get' ? agent.get(path) : agent.post(path).send({});
    await call.expect(401);
  });

  it('rejects a forged token on a resource route', async () => {
    await request(app)
      .get('/api/v1/tasks')
      .set('Authorization', 'Bearer not.a.real.token')
      .expect(401);
  });
});
