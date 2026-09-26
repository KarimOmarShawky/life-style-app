/**
 * Integration tests for projects, tasks and timer sessions (spec section 41).
 *
 * Driven through the real Express app against the real database, so the
 * database CHECK constraints and partial unique indexes are exercised rather
 * than mocked away.
 */
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

import { createApp } from '@/app';

import { STRONG_PASSWORD, testEmail } from '../setup';

let app: Express;
let auth: string;

interface Envelope<T> {
  success: boolean;
  data: T;
  pagination?: { nextCursor: string | null; hasMore: boolean };
}

interface Task {
  id: string;
  title: string;
  projectId: string | null;
  status: string;
  priority: string;
  completedAt: string | null;
  isOverdue: boolean;
  hasTimer: boolean;
  isTimerRunning: boolean;
  totalTrackedSeconds: number;
  isRecurring: boolean;
  recurrenceRule: string | null;
  description: string | null;
}

interface Project {
  id: string;
  name: string;
  description: string | null;
  taskCount: number;
  openTaskCount: number;
}

async function tokenFor(label: string): Promise<string> {
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: testEmail(label), password: STRONG_PASSWORD })
    .expect(201);
  return `Bearer ${response.body.data.tokens.accessToken}`;
}

async function createProject(header: string, name: string): Promise<Project> {
  const response = await request(app)
    .post('/api/v1/projects')
    .set('Authorization', header)
    .send({ name })
    .expect(201);
  return (response.body as Envelope<Project>).data;
}

async function createTask(header: string, body: Record<string, unknown>): Promise<Task> {
  const response = await request(app)
    .post('/api/v1/tasks')
    .set('Authorization', header)
    .send(body)
    .expect(201);
  return (response.body as Envelope<Task>).data;
}

beforeAll(async () => {
  app = createApp();
  auth = await tokenFor('pt-owner');
});

describe('Projects', () => {
  it('creates a project and reports zero task counts', async () => {
    const project = await createProject(auth, 'Project Alpha');

    expect(project.name).toBe('Project Alpha');
    expect(project.taskCount).toBe(0);
    expect(project.openTaskCount).toBe(0);
  });

  it('rejects a duplicate name for the same user', async () => {
    await createProject(auth, 'Duplicate Name');

    const response = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', auth)
      .send({ name: 'Duplicate Name' })
      .expect(409);

    expect(response.body.error.code).toBe('ALREADY_EXISTS');
  });

  it('allows two different users the same project name', async () => {
    // Uniqueness is per user, not global.
    const other = await tokenFor('pt-other-name');
    await createProject(auth, 'Shared Title');
    await createProject(other, 'Shared Title');
  });

  it('counts tasks and open tasks', async () => {
    const project = await createProject(auth, 'Counted Project');
    await createTask(auth, { title: 'Open one', projectId: project.id });
    const done = await createTask(auth, { title: 'Done one', projectId: project.id });

    await request(app)
      .patch(`/api/v1/tasks/${done.id}`)
      .set('Authorization', auth)
      .send({ status: 'done' })
      .expect(200);

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}`)
      .set('Authorization', auth)
      .expect(200);

    const refreshed = (response.body as Envelope<Project>).data;
    expect(refreshed.taskCount).toBe(2);
    expect(refreshed.openTaskCount).toBe(1);
  });

  it('clears the description when null is sent, and leaves it alone when omitted', async () => {
    // Null and undefined mean different things in a PATCH: clear versus ignore.
    const created = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', auth)
      .send({ name: 'Describable', description: 'original' })
      .expect(201);
    const id = (created.body as Envelope<Project>).data.id;

    const untouched = await request(app)
      .patch(`/api/v1/projects/${id}`)
      .set('Authorization', auth)
      .send({ name: 'Describable Renamed' })
      .expect(200);
    expect((untouched.body as Envelope<Project>).data.description).toBe('original');

    const cleared = await request(app)
      .patch(`/api/v1/projects/${id}`)
      .set('Authorization', auth)
      .send({ description: null })
      .expect(200);
    expect((cleared.body as Envelope<Project>).data.description).toBeNull();
  });

  it('rejects an empty update body', async () => {
    const project = await createProject(auth, 'Empty Patch');
    await request(app)
      .patch(`/api/v1/projects/${project.id}`)
      .set('Authorization', auth)
      .send({})
      .expect(422);
  });

  it('keeps tasks when a project is deleted, leaving them ungrouped', async () => {
    // ON DELETE SET NULL, not CASCADE: deleting a container must not destroy
    // its contents.
    const project = await createProject(auth, 'Doomed Project');
    const task = await createTask(auth, { title: 'Survivor', projectId: project.id });

    await request(app)
      .delete(`/api/v1/projects/${project.id}`)
      .set('Authorization', auth)
      .expect(204);

    const response = await request(app)
      .get(`/api/v1/tasks/${task.id}`)
      .set('Authorization', auth)
      .expect(200);

    expect((response.body as Envelope<Task>).data.projectId).toBeNull();
  });

  it('returns 404 when deleting a project twice', async () => {
    const project = await createProject(auth, 'Delete Twice');
    await request(app)
      .delete(`/api/v1/projects/${project.id}`)
      .set('Authorization', auth)
      .expect(204);
    await request(app)
      .delete(`/api/v1/projects/${project.id}`)
      .set('Authorization', auth)
      .expect(404);
  });
});

describe('Tasks', () => {
  it('creates a task with defaults applied', async () => {
    const task = await createTask(auth, { title: 'Plain task' });

    expect(task.status).toBe('todo');
    expect(task.priority).toBe('medium');
    expect(task.projectId).toBeNull();
    expect(task.completedAt).toBeNull();
  });

  it('sets completedAt when done and clears it when reopened', async () => {
    const task = await createTask(auth, { title: 'Toggle me' });

    const done = await request(app)
      .patch(`/api/v1/tasks/${task.id}`)
      .set('Authorization', auth)
      .send({ status: 'done' })
      .expect(200);
    expect((done.body as Envelope<Task>).data.completedAt).not.toBeNull();

    const reopened = await request(app)
      .patch(`/api/v1/tasks/${task.id}`)
      .set('Authorization', auth)
      .send({ status: 'todo' })
      .expect(200);
    expect((reopened.body as Envelope<Task>).data.completedAt).toBeNull();
  });

  it('never reports a completed task as overdue', async () => {
    const task = await createTask(auth, {
      title: 'Late but finished',
      dueDate: '2020-01-01T00:00:00Z',
    });
    expect(task.isOverdue).toBe(true);

    const done = await request(app)
      .patch(`/api/v1/tasks/${task.id}`)
      .set('Authorization', auth)
      .send({ status: 'done' })
      .expect(200);

    expect((done.body as Envelope<Task>).data.isOverdue).toBe(false);
  });

  it('requires a recurrence rule when recurring', async () => {
    await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', auth)
      .send({ title: 'Recurring', isRecurring: true })
      .expect(422);

    const valid = await createTask(auth, {
      title: 'Recurring properly',
      isRecurring: true,
      recurrenceRule: 'FREQ=WEEKLY',
    });
    expect(valid.recurrenceRule).toBe('FREQ=WEEKLY');
  });

  it('clears the recurrence rule when recurrence is switched off', async () => {
    // The database constraint forbids a rule on a non-recurring task, so the
    // service must clear it rather than pass the update straight through.
    const task = await createTask(auth, {
      title: 'Stop recurring',
      isRecurring: true,
      recurrenceRule: 'FREQ=DAILY',
    });

    const response = await request(app)
      .patch(`/api/v1/tasks/${task.id}`)
      .set('Authorization', auth)
      .send({ isRecurring: false })
      .expect(200);

    const updated = (response.body as Envelope<Task>).data;
    expect(updated.isRecurring).toBe(false);
    expect(updated.recurrenceRule).toBeNull();
  });

  it('rejects an unknown field', async () => {
    await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', auth)
      .send({ title: 'Sneaky', userId: '00000000-0000-4000-8000-000000000000' })
      .expect(422);
  });

  it('rejects an invalid status or priority', async () => {
    await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', auth)
      .send({ title: 'Bad status', status: 'almost_done' })
      .expect(422);

    await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', auth)
      .send({ title: 'Bad priority', priority: 'urgent' })
      .expect(422);
  });

  it('rejects a whitespace-only title', async () => {
    await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', auth)
      .send({ title: '   ' })
      .expect(422);
  });
});

describe('Task listing', () => {
  it('pages with a cursor and never repeats a row', async () => {
    const pagingAuth = await tokenFor('pt-paging');
    for (let i = 0; i < 7; i += 1) {
      await createTask(pagingAuth, { title: `Paged ${i}` });
    }

    const first = await request(app)
      .get('/api/v1/tasks?limit=3')
      .set('Authorization', pagingAuth)
      .expect(200);
    const firstBody = first.body as Envelope<Task[]>;

    expect(firstBody.data).toHaveLength(3);
    expect(firstBody.pagination?.hasMore).toBe(true);

    const second = await request(app)
      .get(
        `/api/v1/tasks?limit=3&cursor=${encodeURIComponent(firstBody.pagination?.nextCursor ?? '')}`,
      )
      .set('Authorization', pagingAuth)
      .expect(200);
    const secondBody = second.body as Envelope<Task[]>;

    const firstIds = new Set(firstBody.data.map((t) => t.id));
    const overlap = secondBody.data.filter((t) => firstIds.has(t.id));
    expect(overlap).toHaveLength(0);
  });

  it('caps the page size instead of honouring an absurd limit', async () => {
    await request(app).get('/api/v1/tasks?limit=999999999').set('Authorization', auth).expect(422);
  });

  it('rejects a malformed cursor', async () => {
    await request(app)
      .get('/api/v1/tasks?limit=5&cursor=not-a-real-cursor')
      .set('Authorization', auth)
      .expect(422);
  });

  it('filters by status, priority and overdue', async () => {
    const filterAuth = await tokenFor('pt-filters');
    await createTask(filterAuth, { title: 'High one', priority: 'high' });
    await createTask(filterAuth, { title: 'Low one', priority: 'low' });
    await createTask(filterAuth, { title: 'Overdue one', dueDate: '2020-01-01T00:00:00Z' });

    const high = await request(app)
      .get('/api/v1/tasks?priority=high&limit=100')
      .set('Authorization', filterAuth)
      .expect(200);
    expect((high.body as Envelope<Task[]>).data).toHaveLength(1);

    const overdue = await request(app)
      .get('/api/v1/tasks?overdue=true&limit=100')
      .set('Authorization', filterAuth)
      .expect(200);
    expect((overdue.body as Envelope<Task[]>).data).toHaveLength(1);
  });

  it('rejects an unknown query parameter', async () => {
    await request(app).get('/api/v1/tasks?bogus=1').set('Authorization', auth).expect(422);
  });
});

describe('Timer sessions', () => {
  it('runs a full start, stop and history cycle', async () => {
    const task = await createTask(auth, { title: 'Timed work', hasTimer: true });

    const started = await request(app)
      .post(`/api/v1/tasks/${task.id}/timer/start`)
      .set('Authorization', auth)
      .expect(200);
    expect((started.body as Envelope<Task>).data.isTimerRunning).toBe(true);

    const stopped = await request(app)
      .post(`/api/v1/tasks/${task.id}/timer/stop`)
      .set('Authorization', auth)
      .expect(200);
    expect((stopped.body as Envelope<Task>).data.isTimerRunning).toBe(false);

    const history = await request(app)
      .get(`/api/v1/tasks/${task.id}/timer/sessions`)
      .set('Authorization', auth)
      .expect(200);
    const sessions = (history.body as Envelope<{ durationSeconds: number | null }[]>).data;

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.durationSeconds).not.toBeNull();
  });

  it('refuses to start a second timer on the same task', async () => {
    const task = await createTask(auth, { title: 'Double start', hasTimer: true });

    await request(app)
      .post(`/api/v1/tasks/${task.id}/timer/start`)
      .set('Authorization', auth)
      .expect(200);

    const conflict = await request(app)
      .post(`/api/v1/tasks/${task.id}/timer/start`)
      .set('Authorization', auth)
      .expect(409);

    expect(conflict.body.error.code).toBe('CONFLICT');
  });

  it('refuses to stop a timer that is not running', async () => {
    const task = await createTask(auth, { title: 'Nothing running', hasTimer: true });
    await request(app)
      .post(`/api/v1/tasks/${task.id}/timer/stop`)
      .set('Authorization', auth)
      .expect(409);
  });

  it('refuses to start a timer on a task that has not enabled one', async () => {
    const task = await createTask(auth, { title: 'No timer', hasTimer: false });
    await request(app)
      .post(`/api/v1/tasks/${task.id}/timer/start`)
      .set('Authorization', auth)
      .expect(409);
  });

  it('accumulates tracked time across sessions', async () => {
    const task = await createTask(auth, { title: 'Accumulate', hasTimer: true });

    for (let i = 0; i < 2; i += 1) {
      await request(app)
        .post(`/api/v1/tasks/${task.id}/timer/start`)
        .set('Authorization', auth)
        .expect(200);
      await request(app)
        .post(`/api/v1/tasks/${task.id}/timer/stop`)
        .set('Authorization', auth)
        .expect(200);
    }

    const history = await request(app)
      .get(`/api/v1/tasks/${task.id}/timer/sessions`)
      .set('Authorization', auth)
      .expect(200);

    expect((history.body as Envelope<unknown[]>).data).toHaveLength(2);
  });
});
