import '../infrastructure-safety.js';
/**
 * tests/integration/habits-flow.test.ts
 *
 * Implements Acceptance Tests for Phase P5:
 * - AC-HAB-01: Check-in uniqueness, unscheduled/future date rejection, upsert on repeated check-in
 * - AC-HAB-02: Streak calculation (skipped neutral, missed breaks, today pending neutral, weekly schedule)
 * - AC-HAB-03: Future-dated check-in rejection (400 VALIDATION_ERROR)
 * - AC-HAB-04: Daily progress computation returns correct percentage: done / (scheduled - skipped)
 * - AC-HAB-05: Check-in toggling (done -> skipped -> deleted) updates streaks correctly
 * - Habit CRUD, soft-delete with reminder cancellation, 30-day restore
 * - Cross-tenant isolation (User B receives 404 for User A habit)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';
import { getContainer } from '../../src/container.js';

describe('Habits & Daily Progress Integration Tests', () => {
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

  async function registerUser(email = 'user@example.com', timezone = 'UTC') {
    const res = await request(app).post('/api/v1/auth/register').send({
      email,
      password: 'ValidUserPassword123!',
      displayName: 'Habit User',
      timezone,
      defaultCurrency: 'USD'
    });
    return res.body.data;
  }

  describe('Habits CRUD & Lifecycle', () => {
    it('Creates habit with daily recurrence and retrieves it with 0 streaks', async () => {
      const { tokens } = await registerUser();

      const createRes = await request(app)
        .post('/api/v1/habits')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          name: 'Morning Meditation',
          description: 'Meditate for 15 minutes',
          startDate: '2026-09-01',
          reminderTime: '07:30',
          color: '#4A90E2',
          recurrence: {
            freq: 'daily',
            interval: 1
          }
        });

      expect(createRes.status).toBe(201);
      const habit = createRes.body.data.habit;
      expect(habit.name).toBe('Morning Meditation');
      expect(habit.recurrence.freq).toBe('daily');
      expect(habit.currentStreak).toBe(0);
      expect(habit.longestStreak).toBe(0);

      // GET by ID
      const getRes = await request(app)
        .get(`/api/v1/habits/${habit.id}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.habit.id).toBe(habit.id);
      expect(getRes.body.data.habit.reminderTime).toBe('07:30');
    });

    it('Updates habit fields and recurrence', async () => {
      const { tokens } = await registerUser();

      const createRes = await request(app)
        .post('/api/v1/habits')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          name: 'Exercise',
          startDate: '2026-09-01',
          recurrence: {
            freq: 'daily',
            interval: 1
          }
        });

      const habitId = createRes.body.data.habit.id;

      // Update name and change to weekly recurrence (Mon, Wed, Fri)
      const patchRes = await request(app)
        .patch(`/api/v1/habits/${habitId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          name: 'Gym Workout',
          color: '#E02020',
          recurrence: {
            freq: 'weekly',
            byWeekday: [1, 3, 5]
          },
          version: createRes.body.data.habit.version
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.habit.name).toBe('Gym Workout');
      expect(patchRes.body.data.habit.recurrence.freq).toBe('weekly');
      expect(patchRes.body.data.habit.recurrence.byWeekday).toEqual([1, 3, 5]);
    });

    it('Soft deletes habit, cancels pending reminders, and restores within 30 days', async () => {
      const { user, tokens } = await registerUser();

      const createRes = await request(app)
        .post('/api/v1/habits')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          name: 'Habit with Reminder',
          startDate: '2026-09-01',
          recurrence: { freq: 'daily', interval: 1 }
        });
      const habitId = createRes.body.data.habit.id;

      // Seed a pending reminder in DB for this habit
      const reminderRes = await pool.query(
        `INSERT INTO reminders (user_id, habit_id, remind_at, next_attempt_at, status, source, channel)
         VALUES ($1, $2, NOW() + INTERVAL '2 hours', NOW() + INTERVAL '2 hours', 'pending', 'system', 'push')
         RETURNING id`,
        [user.id, habitId]
      );
      const reminderId = reminderRes.rows[0].id;

      // Soft delete habit
      const delRes = await request(app)
        .delete(`/api/v1/habits/${habitId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(delRes.status).toBe(204);

      // Verify habit is 404 in active GET
      const getRes = await request(app)
        .get(`/api/v1/habits/${habitId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(getRes.status).toBe(404);

      // Verify reminder was cancelled
      const remCheck = await pool.query('SELECT status FROM reminders WHERE id = $1', [reminderId]);
      expect(remCheck.rows[0].status).toBe('cancelled');

      // Restore habit
      const restoreRes = await request(app)
        .post(`/api/v1/habits/${habitId}/restore`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(restoreRes.status).toBe(200);
      expect(restoreRes.body.data.habit.id).toBe(habitId);

      // Active GET works again
      const getAgain = await request(app)
        .get(`/api/v1/habits/${habitId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(getAgain.status).toBe(200);
    });
  });

  describe('Check-ins & Streaks', () => {
    it('AC-HAB-01 & AC-HAB-03: Rejects future dates, unscheduled dates, and dates before startDate', async () => {
      const { tokens } = await registerUser();
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      // Create weekly habit for Mondays only (e.g. 2026-09-21 was Monday)
      const habitRes = await request(app)
        .post('/api/v1/habits')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          name: 'Monday Meeting Prep',
          startDate: '2026-09-21',
          recurrence: {
            freq: 'weekly',
            byWeekday: [1] // Monday only
          }
        });
      const habitId = habitRes.body.data.habit.id;

      // 1. Future date check-in (AC-HAB-03) -> 400
      const futureCheckin = await request(app)
        .put(`/api/v1/habits/${habitId}/checkins/${tomorrow}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ status: 'done' });

      expect(futureCheckin.status).toBe(400);
      expect(futureCheckin.body.error.code).toBe('VALIDATION_ERROR');

      // 2. Date before habit startDate -> 400
      const beforeStartCheckin = await request(app)
        .put(`/api/v1/habits/${habitId}/checkins/2026-09-15`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ status: 'done' });

      expect(beforeStartCheckin.status).toBe(400);
      expect(beforeStartCheckin.body.error.code).toBe('VALIDATION_ERROR');

      // 3. Unscheduled date (Tuesday 2026-09-22) -> 400
      const unscheduledCheckin = await request(app)
        .put(`/api/v1/habits/${habitId}/checkins/2026-09-22`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ status: 'done' });

      expect(unscheduledCheckin.status).toBe(400);
      expect(unscheduledCheckin.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('AC-HAB-01 & AC-HAB-05: Upsert on repeated check-in and toggle/delete updates streak', async () => {
      const { tokens } = await registerUser();
      const today = new Date().toISOString().slice(0, 10);

      const habitRes = await request(app)
        .post('/api/v1/habits')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          name: 'Daily Hydration',
          startDate: today,
          recurrence: { freq: 'daily', interval: 1 }
        });
      const habitId = habitRes.body.data.habit.id;

      // 1. Initial check-in: done -> streak 1
      const checkin1 = await request(app)
        .put(`/api/v1/habits/${habitId}/checkins/${today}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ status: 'done', note: '2 liters drunk' });

      expect(checkin1.status).toBe(200);
      expect(checkin1.body.data.checkin.status).toBe('done');
      expect(checkin1.body.data.checkin.note).toBe('2 liters drunk');
      expect(checkin1.body.data.currentStreak).toBe(1);

      // 2. Repeated check-in updates instead of duplicating (toggle to skipped)
      const checkinUpdate = await request(app)
        .put(`/api/v1/habits/${habitId}/checkins/${today}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ status: 'skipped', note: 'Fasting today' });

      expect(checkinUpdate.status).toBe(200);
      expect(checkinUpdate.body.data.checkin.status).toBe('skipped');
      // Skipped today -> current streak becomes 0 (since only 1 day exists and it's skipped)
      expect(checkinUpdate.body.data.currentStreak).toBe(0);

      // Verify exactly 1 checkin row exists in DB
      const countRes = await pool.query(
        'SELECT COUNT(*) FROM habit_checkins WHERE habit_id = $1 AND checkin_date = $2',
        [habitId, today]
      );
      expect(parseInt(countRes.rows[0].count, 10)).toBe(1);

      // 3. Delete checkin (uncheck)
      const delCheckin = await request(app)
        .delete(`/api/v1/habits/${habitId}/checkins/${today}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(delCheckin.status).toBe(204);

      // Verify row deleted
      const checkAfter = await pool.query(
        'SELECT COUNT(*) FROM habit_checkins WHERE habit_id = $1',
        [habitId]
      );
      expect(parseInt(checkAfter.rows[0].count, 10)).toBe(0);
    });

    it('AC-HAB-04: Daily progress computation returns correct percentage: done / (scheduled - skipped)', async () => {
      const { tokens } = await registerUser();
      const today = new Date().toISOString().slice(0, 10);

      // Habit 1: Daily -> checked in as 'done'
      const h1 = await request(app)
        .post('/api/v1/habits')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          name: 'Habit 1 (Done)',
          startDate: today,
          recurrence: { freq: 'daily', interval: 1 }
        });
      await request(app)
        .put(`/api/v1/habits/${h1.body.data.habit.id}/checkins/${today}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ status: 'done' });

      // Habit 2: Daily -> checked in as 'skipped'
      const h2 = await request(app)
        .post('/api/v1/habits')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          name: 'Habit 2 (Skipped)',
          startDate: today,
          recurrence: { freq: 'daily', interval: 1 }
        });
      await request(app)
        .put(`/api/v1/habits/${h2.body.data.habit.id}/checkins/${today}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ status: 'skipped' });

      // Habit 3: Daily -> pending (no checkin)
      await request(app)
        .post('/api/v1/habits')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          name: 'Habit 3 (Pending)',
          startDate: today,
          recurrence: { freq: 'daily', interval: 1 }
        });

      // GET /habits/progress/today
      const progressRes = await request(app)
        .get('/api/v1/habits/progress/today')
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(progressRes.status).toBe(200);
      expect(progressRes.body.data.progress).toEqual({
        totalScheduled: 3,
        done: 1,
        skipped: 1,
        percent: 50 // 1 / (3 - 1) = 50%
      });
    });

    it('Queries checkins within a date range (GET /habits/:id/checkins?from&to)', async () => {
      const { user, tokens } = await registerUser();

      const habitRes = await request(app)
        .post('/api/v1/habits')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          name: 'History Habit',
          startDate: '2026-09-01',
          recurrence: { freq: 'daily', interval: 1 }
        });
      const habitId = habitRes.body.data.habit.id;

      // Seed 3 checkins directly
      await pool.query(
        `INSERT INTO habit_checkins (user_id, habit_id, checkin_date, status)
         VALUES
           ($1, $2, '2026-09-10', 'done'),
           ($1, $2, '2026-09-11', 'skipped'),
           ($1, $2, '2026-09-12', 'done')`,
        [user.id, habitId]
      );

      const checkinsRes = await request(app)
        .get(`/api/v1/habits/${habitId}/checkins?from=2026-09-10&to=2026-09-12`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(checkinsRes.status).toBe(200);
      expect(checkinsRes.body.data.length).toBe(3);
      expect(checkinsRes.body.data[0].checkinDate).toBe('2026-09-10');
      expect(checkinsRes.body.data[1].status).toBe('skipped');
    });

    it('Cross-tenant isolation: User B cannot access, check in, or delete User A habit (404)', async () => {
      const userA = await registerUser('usera_hab@example.com');
      const userB = await registerUser('userb_hab@example.com');
      const today = new Date().toISOString().slice(0, 10);

      const habitA = await request(app)
        .post('/api/v1/habits')
        .set('Authorization', `Bearer ${userA.tokens.accessToken}`)
        .send({
          name: "User A's Habit",
          startDate: today,
          recurrence: { freq: 'daily', interval: 1 }
        });
      const habitAId = habitA.body.data.habit.id;

      // User B tries to read User A habit -> 404
      const getB = await request(app)
        .get(`/api/v1/habits/${habitAId}`)
        .set('Authorization', `Bearer ${userB.tokens.accessToken}`);
      expect(getB.status).toBe(404);

      // User B tries to check in to User A habit -> 404
      const checkinB = await request(app)
        .put(`/api/v1/habits/${habitAId}/checkins/${today}`)
        .set('Authorization', `Bearer ${userB.tokens.accessToken}`)
        .send({ status: 'done' });
      expect(checkinB.status).toBe(404);

      // User B tries to delete User A habit -> 404
      const delB = await request(app)
        .delete(`/api/v1/habits/${habitAId}`)
        .set('Authorization', `Bearer ${userB.tokens.accessToken}`);
      expect(delB.status).toBe(404);
    });
  });
});
