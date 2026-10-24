import '../infrastructure-safety.js';
/**
 * tests/integration/timer-sessions-flow.test.ts
 *
 * Implements Acceptance Tests for Phase P4:
 * - AC-TMR-01: Max 1 running timer per user (409 TIMER_ALREADY_RUNNING)
 * - AC-TMR-02: Derived session duration from timestamps; client-supplied duration rejected
 * - Auto-close of running timers exceeding 12 hours
 * - Stopping running timer with proper end_reason (completed vs stopped)
 * - Task detail trackedSeconds aggregate calculation
 * - Cross-tenant isolation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';
import { getContainer } from '../../src/container.js';

describe('Timer Sessions Flow Integration Tests', () => {
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

  async function registerUser(email = 'user@example.com') {
    const res = await request(app).post('/api/v1/auth/register').send({
      email,
      password: 'ValidUserPassword123!',
      displayName: 'Timer User',
      timezone: 'UTC',
      defaultCurrency: 'USD'
    });
    return res.body.data;
  }

  async function createTask(tokens: { accessToken: string }, title = 'Test Task') {
    const res = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ title });
    return res.body.data.task;
  }

  it('AC-TMR-01: Starting a timer session when one is already running returns 409 TIMER_ALREADY_RUNNING', async () => {
    const { tokens } = await registerUser();
    const task1 = await createTask(tokens, 'Task 1');
    const task2 = await createTask(tokens, 'Task 2');

    // 1. Start timer on task 1
    const timer1 = await request(app)
      .post('/api/v1/timer-sessions')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({
        taskId: task1.id,
        mode: 'stopwatch'
      });

    expect(timer1.status).toBe(201);
    expect(timer1.body.data.timerSession.taskId).toBe(task1.id);
    expect(timer1.body.data.timerSession.endedAt).toBeNull();

    // 2. Attempt to start another timer while timer 1 is running
    const timer2 = await request(app)
      .post('/api/v1/timer-sessions')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({
        taskId: task2.id,
        mode: 'stopwatch'
      });

    expect(timer2.status).toBe(409);
    expect(timer2.body.error.code).toBe('TIMER_ALREADY_RUNNING');
  });

  it('AC-TMR-02: Session duration is derived from timestamps; client-supplied elapsed seconds are rejected', async () => {
    const { tokens } = await registerUser();
    const task = await createTask(tokens, 'Duration Task');

    // Attempt to pass client-supplied durationSeconds or elapsedSeconds
    const clientSupplied = await request(app)
      .post('/api/v1/timer-sessions')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({
        taskId: task.id,
        mode: 'stopwatch',
        durationSeconds: 300,
        elapsedSeconds: 300
      });

    expect(clientSupplied.status).toBe(400);
    expect(clientSupplied.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('Stops running timer with countdown completion logic, and rejects stopping ended timer with 409', async () => {
    const { user, tokens } = await registerUser();
    const task = await createTask(tokens, 'Countdown Task');

    // 1. Start countdown timer with 120 plannedSeconds
    const startRes = await request(app)
      .post('/api/v1/timer-sessions')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({
        taskId: task.id,
        mode: 'countdown',
        plannedSeconds: 120
      });

    expect(startRes.status).toBe(201);
    const sessionId = startRes.body.data.timerSession.id;

    // Simulate 150 seconds elapsed in DB by moving started_at back
    await pool.query(
      `UPDATE timer_sessions SET started_at = NOW() - INTERVAL '150 seconds' WHERE id = $1 AND user_id = $2`,
      [sessionId, user.id]
    );

    // 2. Stop timer
    const stopRes = await request(app)
      .post(`/api/v1/timer-sessions/${sessionId}/stop`)
      .set('Authorization', `Bearer ${tokens.accessToken}`);

    expect(stopRes.status).toBe(200);
    expect(stopRes.body.data.timerSession.endedAt).not.toBeNull();
    expect(stopRes.body.data.timerSession.durationSeconds).toBeGreaterThanOrEqual(149);
    expect(stopRes.body.data.timerSession.endReason).toBe('completed');

    // 3. Stopping already ended timer returns 409 TIMER_NOT_RUNNING
    const stopAgain = await request(app)
      .post(`/api/v1/timer-sessions/${sessionId}/stop`)
      .set('Authorization', `Bearer ${tokens.accessToken}`);

    expect(stopAgain.status).toBe(409);
    expect(stopAgain.body.error.code).toBe('TIMER_NOT_RUNNING');
  });

  it('Auto-closes running timer exceeding 12 hours (FR-TMR-05) and allows starting new timer', async () => {
    const { user, tokens } = await registerUser();
    const task1 = await createTask(tokens, 'Long Running Task');
    const task2 = await createTask(tokens, 'New Task');

    // Start timer 1
    const timer1 = await request(app)
      .post('/api/v1/timer-sessions')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({
        taskId: task1.id,
        mode: 'stopwatch'
      });
    const timer1Id = timer1.body.data.timerSession.id;

    // Simulate 13 hours passed since timer 1 started
    await pool.query(
      `UPDATE timer_sessions SET started_at = NOW() - INTERVAL '13 hours' WHERE id = $1 AND user_id = $2`,
      [timer1Id, user.id]
    );

    // Starting timer 2 should trigger auto-close of timer 1 and succeed
    const timer2 = await request(app)
      .post('/api/v1/timer-sessions')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({
        taskId: task2.id,
        mode: 'stopwatch'
      });

    expect(timer2.status).toBe(201);

    // Check timer 1 status in DB: ended_at must be populated with end_reason = 'auto_closed'
    const checkTimer1 = await pool.query(
      `SELECT ended_at, end_reason FROM timer_sessions WHERE id = $1`,
      [timer1Id]
    );
    expect(checkTimer1.rows[0].ended_at).not.toBeNull();
    expect(checkTimer1.rows[0].end_reason).toBe('auto_closed');
  });

  it('Aggregates tracked time on task detail endpoint (FR-TMR-06)', async () => {
    const { user, tokens } = await registerUser();
    const task = await createTask(tokens, 'Tracked Task');

    // Completed session 1: 1800 seconds (30 minutes)
    await pool.query(
      `INSERT INTO timer_sessions (user_id, task_id, started_at, ended_at, mode, planned_seconds, end_reason)
       VALUES ($1, $2, NOW() - INTERVAL '40 minutes', NOW() - INTERVAL '10 minutes', 'stopwatch', NULL, 'stopped')`,
      [user.id, task.id]
    );

    // Completed session 2: 1200 seconds (20 minutes)
    await pool.query(
      `INSERT INTO timer_sessions (user_id, task_id, started_at, ended_at, mode, planned_seconds, end_reason)
       VALUES ($1, $2, NOW() - INTERVAL '8 minutes', NOW() - INTERVAL '2 minutes', 'countdown', 360, 'completed')`,
      [user.id, task.id]
    );

    // Running session: started 5 minutes ago (300 seconds)
    await pool.query(
      `INSERT INTO timer_sessions (user_id, task_id, started_at, ended_at, mode, planned_seconds)
       VALUES ($1, $2, NOW() - INTERVAL '5 minutes', NULL, 'stopwatch', NULL)`,
      [user.id, task.id]
    );

    // GET /tasks/:id should return trackedSeconds >= 1800 + 360 (or exact elapsed) + 300
    const taskDetail = await request(app)
      .get(`/api/v1/tasks/${task.id}`)
      .set('Authorization', `Bearer ${tokens.accessToken}`);

    expect(taskDetail.status).toBe(200);
    // 1800 + 360 + ~300 = ~2460 seconds
    expect(taskDetail.body.data.task.trackedSeconds).toBeGreaterThanOrEqual(2400);
  });

  it('Cross-tenant isolation: User B cannot access or stop User A timer session (404)', async () => {
    const userA = await registerUser('usera_tmr@example.com');
    const userB = await registerUser('userb_tmr@example.com');

    const taskA = await createTask(userA.tokens, "User A's Task");

    const sessionA = await request(app)
      .post('/api/v1/timer-sessions')
      .set('Authorization', `Bearer ${userA.tokens.accessToken}`)
      .send({
        taskId: taskA.id,
        mode: 'stopwatch'
      });

    const sessionId = sessionA.body.data.timerSession.id;

    // User B attempts to stop User A's timer -> 404
    const stopB = await request(app)
      .post(`/api/v1/timer-sessions/${sessionId}/stop`)
      .set('Authorization', `Bearer ${userB.tokens.accessToken}`);
    expect(stopB.status).toBe(404);

    // User B attempts to delete User A's timer -> 404
    const delB = await request(app)
      .delete(`/api/v1/timer-sessions/${sessionId}`)
      .set('Authorization', `Bearer ${userB.tokens.accessToken}`);
    expect(delB.status).toBe(404);

    // User B's active timer is null
    const activeB = await request(app)
      .get('/api/v1/timer-sessions/active')
      .set('Authorization', `Bearer ${userB.tokens.accessToken}`);
    expect(activeB.status).toBe(200);
    expect(activeB.body.data.timerSession).toBeNull();
  });

  it('Lists timer sessions with pagination and filters, and deletes a timer session', async () => {
    const { tokens } = await registerUser();
    const task = await createTask(tokens, 'Session Filter Task');

    // Create session 1
    const s1 = await request(app)
      .post('/api/v1/timer-sessions')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ taskId: task.id });
    const s1Id = s1.body.data.timerSession.id;

    // Stop session 1
    await request(app)
      .post(`/api/v1/timer-sessions/${s1Id}/stop`)
      .set('Authorization', `Bearer ${tokens.accessToken}`);

    // Create session 2
    await request(app)
      .post('/api/v1/timer-sessions')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ taskId: task.id });

    // List timer sessions
    const listRes = await request(app)
      .get(`/api/v1/timer-sessions?taskId=${task.id}&limit=10`)
      .set('Authorization', `Bearer ${tokens.accessToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBe(2);

    // Delete session 1
    const delRes = await request(app)
      .delete(`/api/v1/timer-sessions/${s1Id}`)
      .set('Authorization', `Bearer ${tokens.accessToken}`);
    expect(delRes.status).toBe(204);

    // List after deletion
    const listAfter = await request(app)
      .get(`/api/v1/timer-sessions?taskId=${task.id}`)
      .set('Authorization', `Bearer ${tokens.accessToken}`);
    expect(listAfter.body.data.length).toBe(1);
  });
});
