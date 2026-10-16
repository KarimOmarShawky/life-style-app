import '../infrastructure-safety.js';
/**
 * tests/integration/reminders-flow.test.ts
 *
 * Implements Acceptance Tests for Section 14.13 & FR-REM-01..06: Unified
 * Reminders. Reminders attach to tasks, habits, and subscriptions (events keep
 * the calendar routes); the dispatcher invariant (pending => next_attempt_at)
 * and cross-user parent isolation are asserted here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';
import { getContainer } from '../../src/container.js';

describe('Unified Reminders Integration Tests', () => {
  const app = createApp();
  const pool = getPgPool();
  const redis = getRedisClient();

  beforeEach(async () => {
    await pool.query('DELETE FROM users');
    await redis.flushdb();
    const container = getContainer();
    if ('clear' in container.rateLimiter && typeof container.rateLimiter.clear === 'function') {
      container.rateLimiter.clear();
    }
  });

  async function registerUser(email = 'reminders@example.com') {
    const res = await request(app).post('/api/v1/auth/register').send({
      email,
      password: 'ValidUserPassword123!',
      displayName: 'Reminders User',
      timezone: 'UTC',
      defaultCurrency: 'USD'
    });
    return res.body;
  }

  async function createTask(accessToken: string, title = 'Pay the bills') {
    const res = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title, dueDate: '2026-12-01', dueTime: '09:00' });
    expect(res.status).toBe(201);
    return res.body.task;
  }

  async function createHabit(accessToken: string, name = 'Drink water') {
    const res = await request(app)
      .post('/api/v1/habits')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name,
        startDate: '2026-10-01',
        reminderTime: '08:00',
        recurrence: { freq: 'daily' }
      });
    expect(res.status).toBe(201);
    return res.body.habit;
  }

  async function createSubscription(accessToken: string) {
    const res = await request(app)
      .post('/api/v1/money/subscriptions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Gym membership',
        amount: '49.99',
        currency: 'USD',
        billingUnit: 'month',
        billingInterval: 1,
        anchorDate: '2026-12-01'
      });
    expect(res.status).toBe(201);
    return res.body.subscription;
  }

  describe('FR-REM-01..03: reminders on tasks, habits, and subscriptions', () => {
    it('creates, lists, and deletes a task reminder', async () => {
      const { tokens } = await registerUser();
      const task = await createTask(tokens.accessToken);

      const createRes = await request(app)
        .post(`/api/v1/tasks/${task.id}/reminders`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ remindAt: '2026-11-30T09:00:00.000Z', channel: 'in_app' });
      expect(createRes.status).toBe(201);
      expect(createRes.body.reminder).toMatchObject({
        entityType: 'task',
        entityId: task.id,
        status: 'pending',
        channel: 'in_app',
        source: 'user'
      });
      // Dispatcher invariant: a pending reminder always has a next_attempt_at.
      expect(createRes.body.reminder.nextAttemptAt).toBe('2026-11-30T09:00:00.000Z');

      const listRes = await request(app)
        .get(`/api/v1/tasks/${task.id}/reminders`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.reminders).toHaveLength(1);

      const delRes = await request(app)
        .delete(`/api/v1/tasks/${task.id}/reminders/${createRes.body.reminder.id}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(delRes.status).toBe(204);

      const afterRes = await request(app)
        .get(`/api/v1/tasks/${task.id}/reminders`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(afterRes.body.reminders).toHaveLength(0);
    });

    it('creates habit and subscription reminders with the same API', async () => {
      const { tokens } = await registerUser();
      const habit = await createHabit(tokens.accessToken);
      const subscription = await createSubscription(tokens.accessToken);

      const habitReminder = await request(app)
        .post(`/api/v1/habits/${habit.id}/reminders`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ remindAt: '2026-11-30T08:00:00.000Z', channel: 'email' });
      expect(habitReminder.status).toBe(201);
      expect(habitReminder.body.reminder.entityType).toBe('habit');

      const subReminder = await request(app)
        .post(`/api/v1/subscriptions/${subscription.id}/reminders`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ remindAt: '2026-11-25T12:00:00.000Z', offsetMinutes: 60 });
      expect(subReminder.status).toBe(201);
      expect(subReminder.body.reminder.entityType).toBe('subscription');
      expect(subReminder.body.reminder.offsetMinutes).toBe(60);
    });
  });

  describe('FR-REM-04: unified listing across parent types', () => {
    it('lists reminders for all entity types with filters', async () => {
      const { tokens } = await registerUser();
      const task = await createTask(tokens.accessToken);
      const habit = await createHabit(tokens.accessToken);

      await request(app)
        .post(`/api/v1/tasks/${task.id}/reminders`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ remindAt: '2026-11-30T09:00:00.000Z' });
      await request(app)
        .post(`/api/v1/habits/${habit.id}/reminders`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ remindAt: '2026-11-30T08:00:00.000Z' });

      const allRes = await request(app)
        .get('/api/v1/reminders')
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(allRes.status).toBe(200);
      expect(allRes.body.reminders).toHaveLength(2);

      const taskOnly = await request(app)
        .get('/api/v1/reminders?entityType=task')
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(taskOnly.body.reminders).toHaveLength(1);
      expect(taskOnly.body.reminders[0].entityType).toBe('task');

      const windowed = await request(app)
        .get('/api/v1/reminders?from=2026-11-30T08:30:00.000Z')
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(windowed.body.reminders).toHaveLength(1);
      expect(windowed.body.reminders[0].entityType).toBe('task');
    });
  });

  describe('Multi-tenant isolation & validation', () => {
    it("rejects a reminder on another user's task with 404", async () => {
      const alice = await registerUser('alice@example.com');
      const bob = await registerUser('bob@example.com');
      const task = await createTask(alice.tokens.accessToken);

      const res = await request(app)
        .post(`/api/v1/tasks/${task.id}/reminders`)
        .set('Authorization', `Bearer ${bob.tokens.accessToken}`)
        .send({ remindAt: '2026-11-30T09:00:00.000Z' });
      expect(res.status).toBe(404);
    });

    it('scopes deletion to the parent in the path', async () => {
      const { tokens } = await registerUser();
      const taskA = await createTask(tokens.accessToken, 'Task A');
      const taskB = await createTask(tokens.accessToken, 'Task B');

      const created = await request(app)
        .post(`/api/v1/tasks/${taskA.id}/reminders`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ remindAt: '2026-11-30T09:00:00.000Z' });
      expect(created.status).toBe(201);

      const wrongParent = await request(app)
        .delete(`/api/v1/tasks/${taskB.id}/reminders/${created.body.reminder.id}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(wrongParent.status).toBe(404);
    });

    it('validates remindAt and rejects duplicate dedupeKeys', async () => {
      const { tokens } = await registerUser();
      const task = await createTask(tokens.accessToken);

      const invalid = await request(app)
        .post(`/api/v1/tasks/${task.id}/reminders`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ remindAt: 'not-a-date' });
      expect(invalid.status).toBe(400);

      const first = await request(app)
        .post(`/api/v1/tasks/${task.id}/reminders`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ remindAt: '2026-11-30T09:00:00.000Z', dedupeKey: 'billing-1' });
      expect(first.status).toBe(201);

      const duplicate = await request(app)
        .post(`/api/v1/tasks/${task.id}/reminders`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ remindAt: '2026-11-30T10:00:00.000Z', dedupeKey: 'billing-1' });
      expect(duplicate.status).toBe(409);
    });

    it('cancels pending reminders when the parent is soft-deleted (FR-REM lifecycle)', async () => {
      const { tokens } = await registerUser();
      const task = await createTask(tokens.accessToken);

      const created = await request(app)
        .post(`/api/v1/tasks/${task.id}/reminders`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ remindAt: '2026-11-30T09:00:00.000Z' });
      expect(created.status).toBe(201);

      const delTask = await request(app)
        .delete(`/api/v1/tasks/${task.id}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(delTask.status).toBe(204);

      const listRes = await request(app)
        .get(`/api/v1/tasks/${task.id}/reminders`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.reminders).toHaveLength(1);
      expect(listRes.body.reminders[0].status).toBe('cancelled');
      expect(listRes.body.reminders[0].nextAttemptAt).toBeNull();
    });
  });
});
