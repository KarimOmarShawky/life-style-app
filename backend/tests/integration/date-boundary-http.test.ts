import '../infrastructure-safety.js';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';
import { getContainer } from '../../src/container.js';

describe('DATE consumers over authenticated HTTP and PostgreSQL', () => {
  const app = createApp();
  const pool = getPgPool();
  beforeEach(async () => {
    await pool.query('DELETE FROM users');
    await getRedisClient().flushdb();
    const limiter = getContainer().rateLimiter;
    if ('clear' in limiter && typeof limiter.clear === 'function') limiter.clear();
  });

  async function register(timezone: string) {
    const result = await request(app).post('/api/v1/auth/register').send({
      email: 'date-http@example.com',
      password: 'ValidUserPassword123!',
      displayName: 'Date User',
      timezone,
      defaultCurrency: 'USD'
    });
    expect(result.status).toBe(201);
    return result.body.data.tokens.accessToken as string;
  }

  it('anchors a task relative reminder to its stored civil date in the user timezone', async () => {
    const token = await register('Africa/Cairo');
    const dueDate = `${new Date().getUTCFullYear() + 2}-01-15`;
    const expectedReminder = `${dueDate}T06:30:00.000Z`;
    const task = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Due task', dueDate, dueTime: '09:30' });
    expect(task.status).toBe(201);
    expect(task.body.data.task.dueDate).toBe(dueDate);
    const reminder = await request(app)
      .post('/api/v1/reminders')
      .set('Authorization', `Bearer ${token}`)
      .send({ entityType: 'task', entityId: task.body.data.task.id, offsetMinutes: 60 });
    expect(reminder.status).toBe(201);
    expect(reminder.body.data).toMatchObject({
      offsetMinutes: 60,
      remindAt: expectedReminder,
      nextAttemptAt: expectedReminder
    });
    const stored = await pool.query(
      'SELECT remind_at, next_attempt_at FROM reminders WHERE id = $1',
      [reminder.body.data.id]
    );
    expect(stored.rows[0].remind_at.toISOString()).toBe(expectedReminder);
    expect(stored.rows[0].next_attempt_at.toISOString()).toBe(expectedReminder);
  });

  it.each([
    ['startDate', '2028-05-02'],
    ['targetDate', '2028-04-01']
  ])(
    'rejects invalid partial goal %s before write, comparing stored date',
    async (field, value) => {
      const token = await register('UTC');
      const created = await request(app)
        .post('/api/v1/goals')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Goal',
          progressType: 'milestones',
          startDate: '2028-04-15',
          targetDate: '2028-05-01'
        });
      expect(created.status).toBe(201);
      const goal = created.body.data.goal;
      const patch = await request(app)
        .patch(`/api/v1/goals/${goal.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ [field]: value, version: goal.version });
      expect(patch.status).toBe(400);
      expect(patch.body.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [
          { field: 'targetDate', message: 'targetDate must be greater than or equal to startDate' }
        ]
      });
      const row = await pool.query(
        'SELECT start_date::text, target_date::text, version FROM goals WHERE id = $1',
        [goal.id]
      );
      expect(row.rows[0]).toEqual({
        start_date: '2028-04-15',
        target_date: '2028-05-01',
        version: goal.version
      });
      const valid = await request(app)
        .patch(`/api/v1/goals/${goal.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          [field]: field === 'startDate' ? '2028-05-01' : '2028-04-15',
          version: goal.version
        });
      expect(valid.status).toBe(200);
      expect(valid.body.data.goal[field]).toBe(field === 'startDate' ? '2028-05-01' : '2028-04-15');
    }
  );
});
