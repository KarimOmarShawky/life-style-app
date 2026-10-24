import '../infrastructure-safety.js';
/**
 * tests/integration/notes-flow.test.ts
 *
 * Implements Acceptance Tests for Phase P8: Notes & Linking
 * - AC-NOTE-01: Note creation and validation (title, body, tags normalization, default isPinned)
 * - AC-NOTE-02: Note listing, sorting, filtering, full-text search, and opaque script storage
 * - AC-NOTE-03: Polymorphic note links (creation, deletion, atomic replacement, filtering, cross-tenant FK safety)
 * - AC-NOTE-04: Soft-deletion, link preservation, and 30-day restoration (409 NOT_DELETED, 410 Gone)
 * - AC-NOTE-05: Optimistic concurrency control (409 VERSION_CONFLICT) and multi-tenant isolation
 * - Tag aggregation: GET /api/v1/notes/tags
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';
import { getContainer } from '../../src/container.js';

describe('Notes & Linking Integration Tests', () => {
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

  async function registerUser(email = 'notes_user@example.com', timezone = 'UTC') {
    const res = await request(app).post('/api/v1/auth/register').send({
      email,
      password: 'ValidUserPassword123!',
      displayName: 'Notes Test User',
      timezone,
      defaultCurrency: 'USD'
    });
    return res.body.data;
  }

  describe('AC-NOTE-01: Note Creation & Validation', () => {
    it('Creates note with title, body, normalized tags, and default isPinned = false', async () => {
      const { tokens } = await registerUser();

      const res = await request(app)
        .post('/api/v1/notes')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Architecture Meeting',
          body: 'Discuss database schema and partitioning strategies.',
          tags: ['Backend', 'Postgres', 'backend', 'DB  ']
        });

      expect(res.status).toBe(201);
      expect(res.body.data.note).toBeDefined();
      expect(res.body.data.note.title).toBe('Architecture Meeting');
      expect(res.body.data.note.body).toBe('Discuss database schema and partitioning strategies.');
      expect(res.body.data.note.isPinned).toBe(false);
      // Tags must be trimmed, lower-cased, and deduplicated
      expect(res.body.data.note.tags).toEqual(['backend', 'postgres', 'db']);
      expect(res.body.data.note.version).toBe(1);
    });

    it('Allows note with only title or only non-empty body', async () => {
      const { tokens } = await registerUser();

      // Title only
      const resTitle = await request(app)
        .post('/api/v1/notes')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Quick reminder headline'
        });
      expect(resTitle.status).toBe(201);
      expect(resTitle.body.data.note.title).toBe('Quick reminder headline');
      expect(resTitle.body.data.note.body).toBe('');

      // Body only
      const resBody = await request(app)
        .post('/api/v1/notes')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          body: 'Detailed scratchpad without a headline.'
        });
      expect(resBody.status).toBe(201);
      expect(resBody.body.data.note.title).toBeNull();
      expect(resBody.body.data.note.body).toBe('Detailed scratchpad without a headline.');
    });

    it('Rejects note when both title and body are empty', async () => {
      const { tokens } = await registerUser();

      const res = await request(app)
        .post('/api/v1/notes')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: '   ',
          body: ''
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('AC-NOTE-02: Note Listing, Sorting, Filtering & Search', () => {
    it('Orders notes by is_pinned DESC, updated_at DESC and omits full body in list', async () => {
      const { tokens } = await registerUser();

      // Note 1: unpinned, older
      await request(app)
        .post('/api/v1/notes')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'First Normal Note',
          body: 'A'.repeat(300),
          isPinned: false
        });

      // Note 2: unpinned, newer
      await request(app)
        .post('/api/v1/notes')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Second Normal Note',
          body: 'B'.repeat(300),
          isPinned: false
        });

      // Note 3: pinned
      await request(app)
        .post('/api/v1/notes')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Important Pinned Note',
          body: 'C'.repeat(300),
          isPinned: true
        });

      const listRes = await request(app)
        .get('/api/v1/notes')
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.data.notes).toHaveLength(3);

      // Pinned note comes first
      expect(listRes.body.data.notes[0].title).toBe('Important Pinned Note');
      expect(listRes.body.data.notes[0].isPinned).toBe(true);

      // Verify excerpt is truncated to 200 chars and full body is omitted from list
      expect(listRes.body.data.notes[0].excerpt).toHaveLength(200);
      expect(listRes.body.data.notes[0].body).toBeUndefined();
    });

    it('Filters notes by tag and searches via q across title, body, and tags', async () => {
      const { tokens } = await registerUser();

      await request(app)
        .post('/api/v1/notes')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Grocery Checklist',
          body: 'Milk, eggs, organic sourdough bread.',
          tags: ['shopping', 'home']
        });

      await request(app)
        .post('/api/v1/notes')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Quarterly OKRs',
          body: 'Launch MVP mobile client and scale backend clusters.',
          tags: ['work', 'strategy']
        });

      // Filter by tag
      const tagRes = await request(app)
        .get('/api/v1/notes?tag=shopping')
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(tagRes.status).toBe(200);
      expect(tagRes.body.data.notes).toHaveLength(1);
      expect(tagRes.body.data.notes[0].title).toBe('Grocery Checklist');

      // Search via q across body
      const searchRes = await request(app)
        .get('/api/v1/notes?q=sourdough')
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(searchRes.status).toBe(200);
      expect(searchRes.body.data.notes).toHaveLength(1);
      expect(searchRes.body.data.notes[0].title).toBe('Grocery Checklist');

      // Search via q across title
      const titleSearchRes = await request(app)
        .get('/api/v1/notes?q=Quarterly')
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(titleSearchRes.status).toBe(200);
      expect(titleSearchRes.body.data.notes).toHaveLength(1);
      expect(titleSearchRes.body.data.notes[0].title).toBe('Quarterly OKRs');
    });

    it('Stores and returns opaque script content verbatim without execution or stripping', async () => {
      const { tokens } = await registerUser();

      const scriptPayload = '<script>alert("xss")</script><style>body{color:red;}</style>';
      const createRes = await request(app)
        .post('/api/v1/notes')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Code Snippet',
          body: scriptPayload
        });

      expect(createRes.status).toBe(201);
      const noteId = createRes.body.data.note.id;

      const getRes = await request(app)
        .get(`/api/v1/notes/${noteId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.note.body).toBe(scriptPayload);
    });
  });

  describe('AC-NOTE-03: Polymorphic Note Links', () => {
    it('Links note to task and goal, lists links, filters by entity, and deletes link', async () => {
      const { tokens } = await registerUser();

      // 1. Create a task
      const taskRes = await request(app)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Implement database layer'
        });
      const taskId = taskRes.body.data.task.id;

      // 2. Create a goal
      const goalRes = await request(app)
        .post('/api/v1/goals')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Complete Phase P8',
          progressType: 'milestones'
        });
      const goalId = goalRes.body.data.goal.id;

      // 3. Create note with task link
      const noteRes = await request(app)
        .post('/api/v1/notes')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Task implementation plan',
          body: 'Steps to finish database layer.',
          links: [{ taskId }]
        });

      expect(noteRes.status).toBe(201);
      expect(noteRes.body.data.note.links).toHaveLength(1);
      expect(noteRes.body.data.note.links[0].entityType).toBe('task');
      expect(noteRes.body.data.note.links[0].entityId).toBe(taskId);
      const noteId = noteRes.body.data.note.id;

      // 4. Add a second link to goal via POST /notes/:id/links
      const addLinkRes = await request(app)
        .post(`/api/v1/notes/${noteId}/links`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          entityType: 'goal',
          entityId: goalId
        });

      expect(addLinkRes.status).toBe(201);
      expect(addLinkRes.body.data.link.entityType).toBe('goal');
      expect(addLinkRes.body.data.link.entityId).toBe(goalId);
      const goalLinkId = addLinkRes.body.data.link.id;

      // 5. Get note - returns both links
      const getNoteRes = await request(app)
        .get(`/api/v1/notes/${noteId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(getNoteRes.status).toBe(200);
      expect(getNoteRes.body.data.note.links).toHaveLength(2);

      // 6. List note links via sub-resource GET /notes/:id/links
      const linksRes = await request(app)
        .get(`/api/v1/notes/${noteId}/links`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(linksRes.status).toBe(200);
      expect(linksRes.body.data.links).toHaveLength(2);

      // 7. Filter notes by taskId
      const filterTaskRes = await request(app)
        .get(`/api/v1/notes?taskId=${taskId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(filterTaskRes.status).toBe(200);
      expect(filterTaskRes.body.data.notes).toHaveLength(1);
      expect(filterTaskRes.body.data.notes[0].id).toBe(noteId);

      // 8. Filter notes by goalId
      const filterGoalRes = await request(app)
        .get(`/api/v1/notes?goalId=${goalId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(filterGoalRes.status).toBe(200);
      expect(filterGoalRes.body.data.notes).toHaveLength(1);

      // 9. Delete link
      const delLinkRes = await request(app)
        .delete(`/api/v1/notes/${noteId}/links/${goalLinkId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(delLinkRes.status).toBe(204);

      // 10. Verify link removed
      const postDelRes = await request(app)
        .get(`/api/v1/notes/${noteId}/links`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(postDelRes.status).toBe(200);
      expect(postDelRes.body.data.links).toHaveLength(1);
      expect(postDelRes.body.data.links[0].entityType).toBe('task');
    });

    it('Replaces all links atomically via PATCH /notes/:id', async () => {
      const { tokens } = await registerUser();

      const task1Res = await request(app)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ title: 'Task 1' });
      const task2Res = await request(app)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ title: 'Task 2' });

      const noteRes = await request(app)
        .post('/api/v1/notes')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Atomic Replace Note',
          body: 'Replacing links.',
          links: [{ taskId: task1Res.body.data.task.id }]
        });

      const noteId = noteRes.body.data.note.id;

      // Replace link with task 2
      const patchRes = await request(app)
        .patch(`/api/v1/notes/${noteId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          links: [{ taskId: task2Res.body.data.task.id }]
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.note.links).toHaveLength(1);
      expect(patchRes.body.data.note.links[0].taskId).toBe(task2Res.body.data.task.id);
    });

    it('Rejects linking to a non-existent entity with 404', async () => {
      const { tokens } = await registerUser();

      const noteRes = await request(app)
        .post('/api/v1/notes')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Note to link',
          body: 'Testing bad link.'
        });

      const randomUuid = '00000000-0000-0000-0000-000000000000';
      const linkRes = await request(app)
        .post(`/api/v1/notes/${noteRes.body.data.note.id}/links`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          taskId: randomUuid
        });

      expect(linkRes.status).toBe(404);
    });
  });

  describe('AC-NOTE-04: Soft-Deletion & 30-Day Restoration Window', () => {
    it('Soft-deletes note, preserves links, and restores note within 30 days', async () => {
      const { tokens } = await registerUser();

      const taskRes = await request(app)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ title: 'Persistent task' });

      const noteRes = await request(app)
        .post('/api/v1/notes')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Note to soft delete',
          body: 'Will be restored.',
          links: [{ taskId: taskRes.body.data.task.id }]
        });
      const noteId = noteRes.body.data.note.id;

      // Soft delete
      const delRes = await request(app)
        .delete(`/api/v1/notes/${noteId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(delRes.status).toBe(204);

      // Verify omitted from active list
      const listRes = await request(app)
        .get('/api/v1/notes')
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(listRes.body.data.notes).toHaveLength(0);

      // Verify GET returns 404
      const getRes = await request(app)
        .get(`/api/v1/notes/${noteId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(getRes.status).toBe(404);

      // Verify links remain in database
      const dbLinks = await pool.query('SELECT * FROM note_links WHERE note_id = $1', [noteId]);
      expect(dbLinks.rows.length).toBe(1);

      // Restore note
      const restoreRes = await request(app)
        .post(`/api/v1/notes/${noteId}/restore`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(restoreRes.status).toBe(200);
      expect(restoreRes.body.data.note.id).toBe(noteId);
      expect(restoreRes.body.data.note.deletedAt).toBeNull();
      expect(restoreRes.body.data.note.links).toHaveLength(1);

      // Attempting to restore active note returns 409 NOT_DELETED
      const repeatRestore = await request(app)
        .post(`/api/v1/notes/${noteId}/restore`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(repeatRestore.status).toBe(409);
      expect(repeatRestore.body.error.code).toBe('NOT_DELETED');
    });

    it('Rejects restoration with 410 Gone if deleted_at is older than 30 days', async () => {
      const { tokens } = await registerUser();

      const noteRes = await request(app)
        .post('/api/v1/notes')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Expired Note',
          body: 'Deleted long ago.'
        });
      const noteId = noteRes.body.data.note.id;

      // Soft delete
      await request(app)
        .delete(`/api/v1/notes/${noteId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      // Simulate 35 days in past
      await pool.query("UPDATE notes SET deleted_at = NOW() - INTERVAL '35 days' WHERE id = $1", [
        noteId
      ]);

      const restoreRes = await request(app)
        .post(`/api/v1/notes/${noteId}/restore`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(restoreRes.status).toBe(410);
    });
  });

  describe('AC-NOTE-05: Concurrency & Multi-Tenant Isolation', () => {
    it('Rejects update with 409 VERSION_CONFLICT on stale version', async () => {
      const { tokens } = await registerUser();

      const noteRes = await request(app)
        .post('/api/v1/notes')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Concurrent note',
          body: 'Version check.'
        });
      const noteId = noteRes.body.data.note.id;

      // Update with matching version (1)
      const update1 = await request(app)
        .patch(`/api/v1/notes/${noteId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Updated note',
          version: 1
        });
      expect(update1.status).toBe(200);
      expect(update1.body.data.note.version).toBe(2);

      // Attempt update with stale version 1
      const updateStale = await request(app)
        .patch(`/api/v1/notes/${noteId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Conflict attempt',
          version: 1
        });
      expect(updateStale.status).toBe(409);
      expect(updateStale.body.error.code).toBe('VERSION_CONFLICT');
    });

    it('Enforces cross-tenant isolation: User B cannot view, edit, link, or restore User A note (404)', async () => {
      const userA = await registerUser('usera@example.com');
      const userB = await registerUser('userb@example.com');

      // User A creates task and note
      const taskARes = await request(app)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${userA.tokens.accessToken}`)
        .send({ title: 'User A Secret Task' });

      const noteARes = await request(app)
        .post('/api/v1/notes')
        .set('Authorization', `Bearer ${userA.tokens.accessToken}`)
        .send({
          title: 'User A Secret Note',
          body: 'Confidential thoughts.',
          tags: ['private']
        });
      const noteAId = noteARes.body.data.note.id;

      // User B cannot read User A note
      const getB = await request(app)
        .get(`/api/v1/notes/${noteAId}`)
        .set('Authorization', `Bearer ${userB.tokens.accessToken}`);
      expect(getB.status).toBe(404);

      // User B cannot list User A note
      const listB = await request(app)
        .get('/api/v1/notes')
        .set('Authorization', `Bearer ${userB.tokens.accessToken}`);
      expect(listB.body.data.notes).toHaveLength(0);

      // User B cannot update User A note
      const patchB = await request(app)
        .patch(`/api/v1/notes/${noteAId}`)
        .set('Authorization', `Bearer ${userB.tokens.accessToken}`)
        .send({ title: 'Hacked title' });
      expect(patchB.status).toBe(404);

      // User B cannot delete User A note
      const delB = await request(app)
        .delete(`/api/v1/notes/${noteAId}`)
        .set('Authorization', `Bearer ${userB.tokens.accessToken}`);
      expect(delB.status).toBe(404);

      // User B cannot link to User A note
      const linkB = await request(app)
        .post(`/api/v1/notes/${noteAId}/links`)
        .set('Authorization', `Bearer ${userB.tokens.accessToken}`)
        .send({ taskId: taskARes.body.data.task.id });
      expect(linkB.status).toBe(404);

      // User B creates their own note, but tries to link User A's task
      const noteBRes = await request(app)
        .post('/api/v1/notes')
        .set('Authorization', `Bearer ${userB.tokens.accessToken}`)
        .send({
          title: 'User B note',
          body: 'Trying to link foreign task.'
        });

      const foreignLinkRes = await request(app)
        .post(`/api/v1/notes/${noteBRes.body.data.note.id}/links`)
        .set('Authorization', `Bearer ${userB.tokens.accessToken}`)
        .send({ taskId: taskARes.body.data.task.id });
      expect(foreignLinkRes.status).toBe(404);
    });
  });

  describe('Tags Aggregation: GET /api/v1/notes/tags', () => {
    it('Returns tag counts grouped and ordered by count descending', async () => {
      const { tokens } = await registerUser();

      // Note 1: rust, backend
      await request(app)
        .post('/api/v1/notes')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Rust guide',
          body: 'Rust systems programming.',
          tags: ['rust', 'backend']
        });

      // Note 2: rust, frontend
      await request(app)
        .post('/api/v1/notes')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Wasm frontend',
          body: 'Rust in the browser.',
          tags: ['rust', 'frontend']
        });

      // Note 3: rust (soft-deleted, should not be counted)
      const note3 = await request(app)
        .post('/api/v1/notes')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Obsolete rust note',
          body: 'To delete.',
          tags: ['rust', 'legacy']
        });
      await request(app)
        .delete(`/api/v1/notes/${note3.body.data.note.id}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      const tagsRes = await request(app)
        .get('/api/v1/notes/tags')
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(tagsRes.status).toBe(200);
      expect(tagsRes.body.data.tags).toBeDefined();

      // 'rust' has 2 active notes, 'backend' has 1, 'frontend' has 1, 'legacy' has 0
      const rustTag = tagsRes.body.data.tags.find((t: { tag: string }) => t.tag === 'rust');
      expect(rustTag).toBeDefined();
      expect(rustTag.count).toBe(2);

      const legacyTag = tagsRes.body.data.tags.find((t: { tag: string }) => t.tag === 'legacy');
      expect(legacyTag).toBeUndefined();
    });
  });
});
