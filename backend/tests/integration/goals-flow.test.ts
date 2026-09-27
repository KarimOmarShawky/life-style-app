/**
 * tests/integration/goals-flow.test.ts
 *
 * Implements Acceptance Tests for Phase P7: Goals & Milestones
 * - AC-GOAL-01: Goal creation for numeric and milestone types, schema constraints
 * - AC-GOAL-02: Status & completion lifecycle (achieved_at handling, numeric auto-achievement)
 * - AC-GOAL-03: Milestone CRUD, progress aggregation, and auto-achievement on all milestones done
 * - AC-GOAL-04: Soft-deletion, 30-day restore window, and 410 Gone on expired restoration
 * - AC-GOAL-05: Optimistic concurrency control (409 VERSION_CONFLICT) and multi-tenant isolation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';
import { getContainer } from '../../src/container.js';

describe('Goals & Milestones Integration Tests', () => {
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
      displayName: 'Goals User',
      timezone,
      defaultCurrency: 'USD'
    });
    return res.body;
  }

  describe('AC-GOAL-01: Goal Creation & Type Invariants', () => {
    it('Creates numeric goal and milestones goal with valid parameters', async () => {
      const { tokens } = await registerUser();

      // 1. Create numeric goal
      const numRes = await request(app)
        .post('/api/v1/goals')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Read 24 Books',
          progressType: 'numeric',
          targetValue: '24.0000',
          currentValue: '0.0000',
          unit: 'books',
          startDate: '2026-01-01',
          targetDate: '2026-12-31'
        });

      expect(numRes.status).toBe(201);
      expect(numRes.body.goal).toBeDefined();
      expect(numRes.body.goal.title).toBe('Read 24 Books');
      expect(numRes.body.goal.progressType).toBe('numeric');
      expect(numRes.body.goal.targetValue).toBe('24.0000');
      expect(numRes.body.goal.progressPercentage).toBe(0);

      // 2. Create milestone goal
      const msRes = await request(app)
        .post('/api/v1/goals')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Launch SaaS Platform',
          progressType: 'milestones',
          startDate: '2026-01-01',
          targetDate: '2026-06-30'
        });

      expect(msRes.status).toBe(201);
      expect(msRes.body.goal.progressType).toBe('milestones');
      expect(msRes.body.goal.targetValue).toBeNull();
      expect(msRes.body.goal.progressPercentage).toBe(0);
      expect(msRes.body.goal.totalMilestones).toBe(0);
    });

    it('Rejects invalid goal inputs (numeric target <= 0, milestone with targetValue, startDate > targetDate)', async () => {
      const { tokens } = await registerUser();

      // Negative/zero numeric target
      const res1 = await request(app)
        .post('/api/v1/goals')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Invalid Numeric',
          progressType: 'numeric',
          targetValue: '0'
        });
      expect(res1.status).toBe(400);

      // Milestone with targetValue
      const res2 = await request(app)
        .post('/api/v1/goals')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Invalid Milestone',
          progressType: 'milestones',
          targetValue: '10'
        });
      expect(res2.status).toBe(400);

      // startDate > targetDate
      const res3 = await request(app)
        .post('/api/v1/goals')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Invalid Dates',
          progressType: 'milestones',
          startDate: '2026-12-31',
          targetDate: '2026-01-01'
        });
      expect(res3.status).toBe(400);
    });
  });

  describe('AC-GOAL-02: Status & Completion Lifecycle', () => {
    it('Manages achieved status and sets/clears achievedAt timestamp', async () => {
      const { tokens } = await registerUser();

      const createRes = await request(app)
        .post('/api/v1/goals')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Fitness Goal',
          progressType: 'numeric',
          targetValue: '50.0000'
        });
      const goalId = createRes.body.goal.id;
      expect(createRes.body.goal.achievedAt).toBeNull();

      // 1. Manually mark achieved
      const achieveRes = await request(app)
        .patch(`/api/v1/goals/${goalId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ status: 'achieved' });

      expect(achieveRes.status).toBe(200);
      expect(achieveRes.body.goal.status).toBe('achieved');
      expect(achieveRes.body.goal.achievedAt).not.toBeNull();

      // 2. Reopen to active
      const reopenRes = await request(app)
        .patch(`/api/v1/goals/${goalId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ status: 'active' });

      expect(reopenRes.status).toBe(200);
      expect(reopenRes.body.goal.status).toBe('active');
      expect(reopenRes.body.goal.achievedAt).toBeNull();

      // 3. Auto-achievement when currentValue reaches targetValue
      const autoRes = await request(app)
        .patch(`/api/v1/goals/${goalId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ currentValue: '50.0000' });

      expect(autoRes.status).toBe(200);
      expect(autoRes.body.goal.status).toBe('achieved');
      expect(autoRes.body.goal.achievedAt).not.toBeNull();
      expect(autoRes.body.goal.progressPercentage).toBe(100);
    });
  });

  describe('AC-GOAL-03: Milestones Management & Progress Aggregation', () => {
    it('Manages milestones, updates goal progress, and auto-achieves when all complete', async () => {
      const { tokens } = await registerUser();

      // 1. Create milestone goal
      const goalRes = await request(app)
        .post('/api/v1/goals')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Build Mobile App',
          progressType: 'milestones'
        });
      const goalId = goalRes.body.goal.id;

      // 2. Add two milestones
      const m1Res = await request(app)
        .post(`/api/v1/goals/${goalId}/milestones`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ title: 'Design Mockups', sortOrder: 1 });
      const m1Id = m1Res.body.milestone.id;

      const m2Res = await request(app)
        .post(`/api/v1/goals/${goalId}/milestones`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ title: 'Implement Backend', sortOrder: 2 });
      const m2Id = m2Res.body.milestone.id;

      // Verify goal detail reflects 2 milestones, 0% progress
      const detail1 = await request(app)
        .get(`/api/v1/goals/${goalId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(detail1.body.goal.totalMilestones).toBe(2);
      expect(detail1.body.goal.completedMilestones).toBe(0);
      expect(detail1.body.goal.progressPercentage).toBe(0);

      // 3. Complete first milestone -> 50%
      const comp1 = await request(app)
        .patch(`/api/v1/goals/${goalId}/milestones/${m1Id}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ completed: true });
      expect(comp1.status).toBe(200);
      expect(comp1.body.milestone.completed).toBe(true);

      const detail2 = await request(app)
        .get(`/api/v1/goals/${goalId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(detail2.body.goal.completedMilestones).toBe(1);
      expect(detail2.body.goal.progressPercentage).toBe(50);
      expect(detail2.body.goal.status).toBe('active');

      // 4. Complete second milestone -> 100% and auto-achieved
      await request(app)
        .patch(`/api/v1/goals/${goalId}/milestones/${m2Id}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ completed: true });

      const detail3 = await request(app)
        .get(`/api/v1/goals/${goalId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(detail3.body.goal.completedMilestones).toBe(2);
      expect(detail3.body.goal.progressPercentage).toBe(100);
      expect(detail3.body.goal.status).toBe('achieved');

      // 5. Uncomplete second milestone -> auto-reopen to active
      await request(app)
        .patch(`/api/v1/goals/${goalId}/milestones/${m2Id}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ completed: false });

      const detail4 = await request(app)
        .get(`/api/v1/goals/${goalId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(detail4.body.goal.completedMilestones).toBe(1);
      expect(detail4.body.goal.progressPercentage).toBe(50);
      expect(detail4.body.goal.status).toBe('active');
    });

    it('Rejects adding milestones to a numeric goal', async () => {
      const { tokens } = await registerUser();

      const numRes = await request(app)
        .post('/api/v1/goals')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Numeric Only Goal',
          progressType: 'numeric',
          targetValue: '100'
        });
      const goalId = numRes.body.goal.id;

      const addRes = await request(app)
        .post(`/api/v1/goals/${goalId}/milestones`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ title: 'Invalid Milestone' });

      expect(addRes.status).toBe(400);
    });
  });

  describe('AC-GOAL-04: Soft-Deletion & 30-Day Restoration', () => {
    it('Soft-deletes goal and restores within 30 days', async () => {
      const { tokens } = await registerUser();

      const createRes = await request(app)
        .post('/api/v1/goals')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Goal to Delete',
          progressType: 'milestones'
        });
      const goalId = createRes.body.goal.id;

      // Soft delete
      const delRes = await request(app)
        .delete(`/api/v1/goals/${goalId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(delRes.status).toBe(204);

      // GET returns 404
      const getRes = await request(app)
        .get(`/api/v1/goals/${goalId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(getRes.status).toBe(404);

      // Restore
      const restoreRes = await request(app)
        .post(`/api/v1/goals/${goalId}/restore`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(restoreRes.status).toBe(200);
      expect(restoreRes.body.goal.id).toBe(goalId);
      expect(restoreRes.body.goal.deletedAt).toBeNull();
    });

    it('Rejects restoration when soft-deleted more than 30 days ago (410 Gone)', async () => {
      const { tokens } = await registerUser();

      const createRes = await request(app)
        .post('/api/v1/goals')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Old Goal',
          progressType: 'milestones'
        });
      const goalId = createRes.body.goal.id;

      // Soft delete
      await request(app)
        .delete(`/api/v1/goals/${goalId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      // Artificially age deleted_at to 35 days ago
      await pool.query(`UPDATE goals SET deleted_at = NOW() - INTERVAL '35 days' WHERE id = $1`, [
        goalId
      ]);

      // Restore -> 410
      const restoreRes = await request(app)
        .post(`/api/v1/goals/${goalId}/restore`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(restoreRes.status).toBe(410);
    });
  });

  describe('AC-GOAL-05: Concurrency & Multi-Tenant Isolation', () => {
    it('Rejects stale version update with 409 VERSION_CONFLICT', async () => {
      const { tokens } = await registerUser();

      const createRes = await request(app)
        .post('/api/v1/goals')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Version Controlled Goal',
          progressType: 'numeric',
          targetValue: '100'
        });
      const goalId = createRes.body.goal.id;

      // Successful update
      const update1 = await request(app)
        .patch(`/api/v1/goals/${goalId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Updated Goal Title',
          version: 1
        });
      expect(update1.status).toBe(200);
      expect(update1.body.goal.version).toBe(2);

      // Stale update with version 1 -> 409
      const update2 = await request(app)
        .patch(`/api/v1/goals/${goalId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Conflicting Title',
          version: 1
        });
      expect(update2.status).toBe(409);
      expect(update2.body.error.code).toBe('VERSION_CONFLICT');
    });

    it('Enforces multi-tenant isolation: User B cannot access User A goal or milestones (404)', async () => {
      const userA = await registerUser('usera@example.com');
      const userB = await registerUser('userb@example.com');

      const createRes = await request(app)
        .post('/api/v1/goals')
        .set('Authorization', `Bearer ${userA.tokens.accessToken}`)
        .send({
          title: 'User A Secret Goal',
          progressType: 'milestones'
        });
      const goalId = createRes.body.goal.id;

      // User B attempts GET -> 404
      const getRes = await request(app)
        .get(`/api/v1/goals/${goalId}`)
        .set('Authorization', `Bearer ${userB.tokens.accessToken}`);
      expect(getRes.status).toBe(404);

      // User B attempts PATCH -> 404
      const patchRes = await request(app)
        .patch(`/api/v1/goals/${goalId}`)
        .set('Authorization', `Bearer ${userB.tokens.accessToken}`)
        .send({ title: 'Hacked Goal' });
      expect(patchRes.status).toBe(404);

      // User B attempts DELETE -> 404
      const delRes = await request(app)
        .delete(`/api/v1/goals/${goalId}`)
        .set('Authorization', `Bearer ${userB.tokens.accessToken}`);
      expect(delRes.status).toBe(404);

      // User B attempts to add milestone -> 404
      const msRes = await request(app)
        .post(`/api/v1/goals/${goalId}/milestones`)
        .set('Authorization', `Bearer ${userB.tokens.accessToken}`)
        .send({ title: 'Hacked Milestone' });
      expect(msRes.status).toBe(404);
    });
  });
});
