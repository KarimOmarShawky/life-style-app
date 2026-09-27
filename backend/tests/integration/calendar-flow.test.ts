/**
 * tests/integration/calendar-flow.test.ts
 *
 * Implements Acceptance Tests for Phase P6: Calendar & Time Blocking
 * - AC-CAL-01: Calendar Event CRUD, date range queries, timezone, and endAt >= startAt validation
 * - AC-CAL-02: Conflict detection endpoint detecting overlapping time blocks (with excludeEventId)
 * - AC-CAL-03: Soft-deletion sets deleted_at, cancels reminders; 30-day restore window (410 on expiry)
 * - AC-CAL-04: Optimistic concurrency control (version increments, 409 VERSION_CONFLICT on mismatch)
 * - AC-CAL-05: Multi-tenant isolation (User B receives 404 for User A events and cannot modify them)
 * - Linked Reminders lifecycle & auto-cancellation
 * - Timezone-aware Daily Agenda view
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';
import { getContainer } from '../../src/container.js';

describe('Calendar & Time Blocking Integration Tests', () => {
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
      displayName: 'Calendar User',
      timezone,
      defaultCurrency: 'USD'
    });
    return res.body;
  }

  describe('AC-CAL-01: Event CRUD & Date Range Queries', () => {
    it('Creates an event, retrieves it by ID, and lists within date range', async () => {
      const { tokens } = await registerUser();

      // 1. Create Event
      const createRes = await request(app)
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Deep Work Block',
          description: 'Focus on LifeStyle architecture',
          location: 'Home Office',
          startAt: '2026-10-01T10:00:00.000Z',
          endAt: '2026-10-01T12:00:00.000Z',
          allDay: false,
          timezone: 'UTC'
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.event).toBeDefined();
      expect(createRes.body.event.title).toBe('Deep Work Block');
      expect(createRes.body.event.version).toBe(1);
      const eventId = createRes.body.event.id;

      // 2. Retrieve by ID
      const getRes = await request(app)
        .get(`/api/v1/events/${eventId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.event.id).toBe(eventId);
      expect(getRes.body.event.description).toBe('Focus on LifeStyle architecture');

      // 3. List with matching range
      const listRes = await request(app)
        .get('/api/v1/events')
        .query({
          from: '2026-10-01T00:00:00.000Z',
          to: '2026-10-01T23:59:59.000Z'
        })
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.events).toHaveLength(1);
      expect(listRes.body.events[0].id).toBe(eventId);

      // 4. List with non-matching range
      const listEmptyRes = await request(app)
        .get('/api/v1/events')
        .query({
          from: '2026-10-05T00:00:00.000Z',
          to: '2026-10-05T23:59:59.000Z'
        })
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(listEmptyRes.status).toBe(200);
      expect(listEmptyRes.body.events).toHaveLength(0);
    });

    it('Rejects event creation when endAt is earlier than startAt', async () => {
      const { tokens } = await registerUser();

      const res = await request(app)
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Invalid Event',
          startAt: '2026-10-01T12:00:00.000Z',
          endAt: '2026-10-01T10:00:00.000Z',
          timezone: 'UTC'
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('AC-CAL-02: Conflict Detection', () => {
    it('Detects overlapping time blocks and respects excludeEventId', async () => {
      const { tokens } = await registerUser();

      // Create Event 1: 10:00 to 12:00
      const e1Res = await request(app)
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Team Sync',
          startAt: '2026-10-01T10:00:00.000Z',
          endAt: '2026-10-01T12:00:00.000Z',
          timezone: 'UTC'
        });
      const event1Id = e1Res.body.event.id;

      // 1. Conflict query overlapping: 11:00 to 13:00 -> Conflict
      const conflictRes1 = await request(app)
        .get('/api/v1/events/conflicts')
        .query({
          startAt: '2026-10-01T11:00:00.000Z',
          endAt: '2026-10-01T13:00:00.000Z'
        })
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(conflictRes1.status).toBe(200);
      expect(conflictRes1.body.hasConflict).toBe(true);
      expect(conflictRes1.body.conflicts).toHaveLength(1);
      expect(conflictRes1.body.conflicts[0].id).toBe(event1Id);

      // 2. Conflict query non-overlapping: 12:00 to 14:00 (adjacent) -> No conflict
      const nonConflictRes = await request(app)
        .get('/api/v1/events/conflicts')
        .query({
          startAt: '2026-10-01T12:00:00.000Z',
          endAt: '2026-10-01T14:00:00.000Z'
        })
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(nonConflictRes.status).toBe(200);
      expect(nonConflictRes.body.hasConflict).toBe(false);
      expect(nonConflictRes.body.conflicts).toHaveLength(0);

      // 3. Conflict query overlapping but excluding event1Id -> No conflict
      const excludeRes = await request(app)
        .get('/api/v1/events/conflicts')
        .query({
          startAt: '2026-10-01T11:00:00.000Z',
          endAt: '2026-10-01T13:00:00.000Z',
          excludeEventId: event1Id
        })
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(excludeRes.status).toBe(200);
      expect(excludeRes.body.hasConflict).toBe(false);
      expect(excludeRes.body.conflicts).toHaveLength(0);
    });
  });

  describe('AC-CAL-03: Soft-Deletion, Reminder Cancellation & 30-Day Restore', () => {
    it('Soft-deletes event, cancels pending reminders, and restores within 30 days', async () => {
      const { tokens } = await registerUser();

      // 1. Create event with a reminder
      const createRes = await request(app)
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Dentist Appointment',
          startAt: '2026-10-02T14:00:00.000Z',
          endAt: '2026-10-02T15:00:00.000Z',
          timezone: 'UTC',
          reminders: [
            {
              channel: 'push',
              offsetMinutes: 30
            }
          ]
        });
      const eventId = createRes.body.event.id;

      // Verify reminder exists in database with status pending
      const remCheck = await pool.query(`SELECT status FROM reminders WHERE event_id = $1`, [
        eventId
      ]);
      expect(remCheck.rows).toHaveLength(1);
      expect(remCheck.rows[0].status).toBe('pending');

      // 2. Soft-delete event
      const deleteRes = await request(app)
        .delete(`/api/v1/events/${eventId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(deleteRes.status).toBe(204);

      // Verify reminder is now cancelled
      const remAfterDelete = await pool.query(`SELECT status FROM reminders WHERE event_id = $1`, [
        eventId
      ]);
      expect(remAfterDelete.rows[0].status).toBe('cancelled');

      // 3. GET returns 404
      const getDeletedRes = await request(app)
        .get(`/api/v1/events/${eventId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(getDeletedRes.status).toBe(404);

      // 4. Restore event within 30 days
      const restoreRes = await request(app)
        .post(`/api/v1/events/${eventId}/restore`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(restoreRes.status).toBe(200);
      expect(restoreRes.body.event.id).toBe(eventId);
      expect(restoreRes.body.event.deletedAt).toBeNull();
    });

    it('Rejects restoration when soft-deleted more than 30 days ago (410 Gone)', async () => {
      const { tokens } = await registerUser();

      const createRes = await request(app)
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Ancient Event',
          startAt: '2026-08-01T10:00:00.000Z',
          endAt: '2026-08-01T11:00:00.000Z',
          timezone: 'UTC'
        });
      const eventId = createRes.body.event.id;

      // Soft delete
      await request(app)
        .delete(`/api/v1/events/${eventId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      // Artificially age deleted_at to 35 days ago
      await pool.query(`UPDATE events SET deleted_at = NOW() - INTERVAL '35 days' WHERE id = $1`, [
        eventId
      ]);

      // Attempt restore -> 410
      const restoreRes = await request(app)
        .post(`/api/v1/events/${eventId}/restore`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(restoreRes.status).toBe(410);
    });
  });

  describe('AC-CAL-04: Optimistic Concurrency Control', () => {
    it('Increments version on update and rejects stale version with 409 VERSION_CONFLICT', async () => {
      const { tokens } = await registerUser();

      const createRes = await request(app)
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Version Controlled Event',
          startAt: '2026-10-01T10:00:00.000Z',
          endAt: '2026-10-01T11:00:00.000Z',
          timezone: 'UTC'
        });

      const eventId = createRes.body.event.id;
      expect(createRes.body.event.version).toBe(1);

      // 1. Successful update matching version 1
      const updateRes1 = await request(app)
        .patch(`/api/v1/events/${eventId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Updated Event Title',
          version: 1
        });

      expect(updateRes1.status).toBe(200);
      expect(updateRes1.body.event.title).toBe('Updated Event Title');
      expect(updateRes1.body.event.version).toBe(2);

      // 2. Stale update attempting with old version 1 -> 409
      const updateRes2 = await request(app)
        .patch(`/api/v1/events/${eventId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Conflicting Title',
          version: 1
        });

      expect(updateRes2.status).toBe(409);
      expect(updateRes2.body.error.code).toBe('VERSION_CONFLICT');
    });
  });

  describe('AC-CAL-05: Multi-Tenant Isolation', () => {
    it('User B cannot view, modify, or delete User A event (returns 404)', async () => {
      const userA = await registerUser('usera@example.com');
      const userB = await registerUser('userb@example.com');

      // User A creates event
      const createRes = await request(app)
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${userA.tokens.accessToken}`)
        .send({
          title: 'User A Secret Event',
          startAt: '2026-10-01T10:00:00.000Z',
          endAt: '2026-10-01T11:00:00.000Z',
          timezone: 'UTC'
        });
      const eventId = createRes.body.event.id;

      // User B attempts GET -> 404
      const getRes = await request(app)
        .get(`/api/v1/events/${eventId}`)
        .set('Authorization', `Bearer ${userB.tokens.accessToken}`);
      expect(getRes.status).toBe(404);

      // User B attempts PATCH -> 404
      const patchRes = await request(app)
        .patch(`/api/v1/events/${eventId}`)
        .set('Authorization', `Bearer ${userB.tokens.accessToken}`)
        .send({ title: 'Hacked Title' });
      expect(patchRes.status).toBe(404);

      // User B attempts DELETE -> 404
      const deleteRes = await request(app)
        .delete(`/api/v1/events/${eventId}`)
        .set('Authorization', `Bearer ${userB.tokens.accessToken}`);
      expect(deleteRes.status).toBe(404);

      // User B conflict check does not see User A event
      const conflictRes = await request(app)
        .get('/api/v1/events/conflicts')
        .query({
          startAt: '2026-10-01T10:00:00.000Z',
          endAt: '2026-10-01T11:00:00.000Z'
        })
        .set('Authorization', `Bearer ${userB.tokens.accessToken}`);

      expect(conflictRes.status).toBe(200);
      expect(conflictRes.body.hasConflict).toBe(false);
      expect(conflictRes.body.conflicts).toHaveLength(0);
    });
  });

  describe('Reminders Management & Agenda View', () => {
    it('Manages reminders on an event and returns agenda view for calendar date', async () => {
      const { tokens } = await registerUser('agenda@example.com', 'UTC');

      // 1. Create Event
      const createRes = await request(app)
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Design Review',
          startAt: '2026-10-01T15:00:00.000Z',
          endAt: '2026-10-01T16:00:00.000Z',
          timezone: 'UTC'
        });
      const eventId = createRes.body.event.id;

      // 2. Add reminder to event
      const addRemRes = await request(app)
        .post(`/api/v1/events/${eventId}/reminders`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          channel: 'in_app',
          offsetMinutes: 10
        });

      expect(addRemRes.status).toBe(201);
      expect(addRemRes.body.reminder).toBeDefined();
      expect(addRemRes.body.reminder.channel).toBe('in_app');
      const reminderId = addRemRes.body.reminder.id;

      // 3. List reminders
      const listRemRes = await request(app)
        .get(`/api/v1/events/${eventId}/reminders`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(listRemRes.status).toBe(200);
      expect(listRemRes.body.reminders).toHaveLength(1);

      // 4. Delete reminder
      const delRemRes = await request(app)
        .delete(`/api/v1/events/${eventId}/reminders/${reminderId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(delRemRes.status).toBe(204);

      // 5. Query Agenda for 2026-10-01
      const agendaRes = await request(app)
        .get('/api/v1/events/agenda')
        .query({ date: '2026-10-01' })
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(agendaRes.status).toBe(200);
      expect(agendaRes.body.totalEvents).toBe(1);
      expect(agendaRes.body.events[0].id).toBe(eventId);

      // 6. Query Agenda for 2026-10-02 -> 0 events
      const nextDayRes = await request(app)
        .get('/api/v1/events/agenda')
        .query({ date: '2026-10-02' })
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(nextDayRes.status).toBe(200);
      expect(nextDayRes.body.totalEvents).toBe(0);
    });
  });
});
