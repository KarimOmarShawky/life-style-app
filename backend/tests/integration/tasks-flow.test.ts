import '../infrastructure-safety.js';
/**
 * tests/integration/tasks-flow.test.ts
 *
 * Implements Acceptance Tests for Phase P4:
 * - AC-TASK-01: Task completion lifecycle (status=done sets completed_at, reopening clears it)
 * - AC-TASK-02: Atomic focus task unpinning on isFocus: true per date
 * - AC-TASK-03: Timezone-aware overdue computation (due_date < user_today AND status NOT IN ('done', 'cancelled'))
 * - AC-TASK-04: Soft-delete with 30-day restore window and reminder cancellation
 * - AC-TASK-05: Allow-listed sorting validation (rejects invalid fields with 400)
 * - AC-PROJ-01: Project deletion detaches tasks by default (tasks.project_id = NULL); cascade=true soft-deletes them
 * - AC-REC-01: Creating recurring task idempotently generates first 7 days of instances
 * - AC-REC-02: Template update updates future, non-customized, open instances; soft-delete preserves instances
 * - Cross-tenant isolation across tasks, projects, and recurring tasks
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { getRedisClient } from '../../src/infrastructure/redis/redis-client.js';
import { getContainer } from '../../src/container.js';

describe('Tasks, Projects & Recurring Tasks Integration Tests', () => {
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
      displayName: 'Task User',
      timezone,
      defaultCurrency: 'USD'
    });
    return res.body.data;
  }

  describe('Tasks Feature', () => {
    it('AC-TASK-01: Marking task done sets completed_at; reopening clears it', async () => {
      const { tokens } = await registerUser();

      // 1. Create task with default status todo
      const createRes = await request(app)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Implement Task Completion',
          priority: 'high'
        });

      expect(createRes.status).toBe(201);
      const taskId = createRes.body.data.task.id;
      expect(createRes.body.data.task.completedAt).toBeNull();
      expect(createRes.body.data.task.status).toBe('todo');

      // 2. Mark task as done
      const doneRes = await request(app)
        .patch(`/api/v1/tasks/${taskId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          status: 'done'
        });

      expect(doneRes.status).toBe(200);
      expect(doneRes.body.data.task.status).toBe('done');
      expect(doneRes.body.data.task.completedAt).not.toBeNull();
      expect(Number.isNaN(Date.parse(doneRes.body.data.task.completedAt))).toBe(false);

      // 3. Reopen task
      const reopenRes = await request(app)
        .patch(`/api/v1/tasks/${taskId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          status: 'in_progress'
        });

      expect(reopenRes.status).toBe(200);
      expect(reopenRes.body.data.task.status).toBe('in_progress');
      expect(reopenRes.body.data.task.completedAt).toBeNull();

      // 4. Mark done directly on create
      const directDoneRes = await request(app)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Already Finished Task',
          status: 'done'
        });

      expect(directDoneRes.status).toBe(201);
      expect(directDoneRes.body.data.task.completedAt).not.toBeNull();
    });

    it('AC-TASK-02: Marking task as focus unpins any existing focus task on same date in same transaction', async () => {
      const { tokens } = await registerUser();
      const plannedDate = '2026-10-15';

      // 1. Create task 1 as focus for plannedDate
      const task1Res = await request(app)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Focus Task 1',
          plannedDate,
          isFocus: true
        });

      expect(task1Res.status).toBe(201);
      const task1Id = task1Res.body.data.task.id;
      expect(task1Res.body.data.task.isFocus).toBe(true);

      // 2. Create task 2 on same plannedDate without focus
      const task2Res = await request(app)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Task 2',
          plannedDate,
          isFocus: false
        });
      const task2Id = task2Res.body.data.task.id;

      // 3. Update task 2 to become focus
      const updateTask2 = await request(app)
        .patch(`/api/v1/tasks/${task2Id}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          isFocus: true
        });

      expect(updateTask2.status).toBe(200);
      expect(updateTask2.body.data.task.isFocus).toBe(true);

      // Verify task 1 is now automatically unfocused
      const getTask1 = await request(app)
        .get(`/api/v1/tasks/${task1Id}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(getTask1.status).toBe(200);
      expect(getTask1.body.data.task.isFocus).toBe(false);

      // 4. Create task 3 directly as focus on that date -> task 2 must be unfocused
      const task3Res = await request(app)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Focus Task 3',
          plannedDate,
          isFocus: true
        });
      expect(task3Res.status).toBe(201);
      expect(task3Res.body.data.task.isFocus).toBe(true);

      const getTask2 = await request(app)
        .get(`/api/v1/tasks/${task2Id}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(getTask2.body.data.task.isFocus).toBe(false);
    });

    it('AC-TASK-03: Overdue filter includes tasks where due_date < user_today AND status NOT IN (done, cancelled)', async () => {
      // User in Africa/Cairo (+02:00 or +03:00)
      const { tokens } = await registerUser('cairo@example.com', 'Africa/Cairo');

      // Task 1: Overdue (due in 2026-01-01, status todo)
      const overdueTask = await request(app)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Old Overdue Task',
          dueDate: '2026-01-01',
          status: 'todo'
        });

      // Task 2: Due in past, but done -> NOT overdue
      await request(app)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Old Finished Task',
          dueDate: '2026-01-01',
          status: 'done'
        });

      // Task 3: Due in past, but cancelled -> NOT overdue
      await request(app)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Old Cancelled Task',
          dueDate: '2026-01-01',
          status: 'cancelled'
        });

      // Task 4: Future task (due in 2028) -> NOT overdue
      await request(app)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Future Task',
          dueDate: '2028-01-01',
          status: 'todo'
        });

      // Filter with overdue=true
      const res = await request(app)
        .get('/api/v1/tasks?overdue=true')
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].id).toBe(overdueTask.body.data.task.id);
      expect(res.body.data[0].title).toBe('Old Overdue Task');
    });

    it('AC-TASK-04: Soft-delete task with 30-day restore window and reminder cancellation', async () => {
      const { user, tokens } = await registerUser();

      const taskRes = await request(app)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Task with Reminders'
        });
      const taskId = taskRes.body.data.task.id;

      // Seed a pending reminder for this task in the DB
      const reminderIdRes = await pool.query(
        `INSERT INTO reminders (user_id, task_id, remind_at, next_attempt_at, status, source, channel)
         VALUES ($1, $2, NOW() + INTERVAL '1 hour', NOW() + INTERVAL '1 hour', 'pending', 'user', 'push')
         RETURNING id`,
        [user.id, taskId]
      );
      const reminderId = reminderIdRes.rows[0].id;

      // Soft delete the task
      const delRes = await request(app)
        .delete(`/api/v1/tasks/${taskId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(delRes.status).toBe(204);

      // Task is no longer visible in active list or get
      const getRes = await request(app)
        .get(`/api/v1/tasks/${taskId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(getRes.status).toBe(404);

      // Verify reminder was cancelled
      const remCheck = await pool.query('SELECT status FROM reminders WHERE id = $1', [reminderId]);
      expect(remCheck.rows[0].status).toBe('cancelled');

      // Restore the task
      const restoreRes = await request(app)
        .post(`/api/v1/tasks/${taskId}/restore`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(restoreRes.status).toBe(200);
      expect(restoreRes.body.data.task.id).toBe(taskId);

      // Active GET now works again
      const getAfterRestore = await request(app)
        .get(`/api/v1/tasks/${taskId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(getAfterRestore.status).toBe(200);
    });

    it('AC-TASK-05: Invalid sort parameters return 400', async () => {
      const { tokens } = await registerUser();

      // Sort by valid field
      const validRes = await request(app)
        .get('/api/v1/tasks?sort=dueDate&order=desc')
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(validRes.status).toBe(200);

      // Sort by disallowed field (e.g. title or random sql injection attempt)
      const invalidRes = await request(app)
        .get('/api/v1/tasks?sort=title')
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(invalidRes.status).toBe(400);
      expect(invalidRes.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('Enforces optimistic concurrency control (ADR-029) on task update', async () => {
      const { tokens } = await registerUser();

      const taskRes = await request(app)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ title: 'Concurrent Task' });

      const taskId = taskRes.body.data.task.id;
      const initialVersion = taskRes.body.data.task.version;

      // Update with correct version
      const update1 = await request(app)
        .patch(`/api/v1/tasks/${taskId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Updated Once',
          version: initialVersion
        });
      expect(update1.status).toBe(200);
      expect(update1.body.data.task.version).toBe(initialVersion + 1);

      // Stale update using old initialVersion fails with 409 VERSION_CONFLICT
      const staleUpdate = await request(app)
        .patch(`/api/v1/tasks/${taskId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Stale Attempt',
          version: initialVersion
        });

      expect(staleUpdate.status).toBe(409);
      expect(staleUpdate.body.error.code).toBe('VERSION_CONFLICT');
    });

    it('Validates dueTime requires dueDate, and isFocus requires plannedDate', async () => {
      const { tokens } = await registerUser();

      // Create task without dueDate, but with dueTime -> 400
      const badDueTime = await request(app)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Task bad due time',
          dueTime: '10:00'
        });
      expect(badDueTime.status).toBe(400);

      // Create task without plannedDate, but with isFocus -> 400
      const badFocus = await request(app)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Task bad focus',
          isFocus: true
        });
      expect(badFocus.status).toBe(400);
    });
  });

  describe('Projects Feature', () => {
    it('AC-PROJ-01: Default delete detaches tasks (tasks.project_id = NULL); cascade=true soft-deletes them', async () => {
      const { tokens } = await registerUser();

      // 1. Create project 1
      const proj1Res = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          name: 'Project Detach Test',
          color: '#336699'
        });
      const proj1Id = proj1Res.body.data.project.id;

      // Attach task to project 1
      const task1Res = await request(app)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Detachable Task',
          projectId: proj1Id
        });
      const task1Id = task1Res.body.data.task.id;

      // Delete project 1 with default cascade=false
      const delProj1 = await request(app)
        .delete(`/api/v1/projects/${proj1Id}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(delProj1.status).toBe(204);

      // Verify task 1 still exists, but has project_id = null
      const checkTask1 = await request(app)
        .get(`/api/v1/tasks/${task1Id}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(checkTask1.status).toBe(200);
      expect(checkTask1.body.data.task.projectId).toBeNull();

      // 2. Create project 2
      const proj2Res = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          name: 'Project Cascade Test'
        });
      const proj2Id = proj2Res.body.data.project.id;

      // Attach task to project 2
      const task2Res = await request(app)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Cascaded Task',
          projectId: proj2Id
        });
      const task2Id = task2Res.body.data.task.id;

      // Delete project 2 with cascade=true
      const delProj2 = await request(app)
        .delete(`/api/v1/projects/${proj2Id}?cascade=true`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(delProj2.status).toBe(204);

      // Verify task 2 was soft-deleted
      const checkTask2 = await request(app)
        .get(`/api/v1/tasks/${task2Id}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(checkTask2.status).toBe(404);
    });

    it('Derives open/done task counts on project list and detail', async () => {
      const { tokens } = await registerUser();

      const projRes = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          name: 'Task Counts Project'
        });
      const projId = projRes.body.data.project.id;

      // Add 2 open tasks (todo, in_progress)
      await request(app)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ title: 'Open 1', projectId: projId, status: 'todo' });

      await request(app)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ title: 'Open 2', projectId: projId, status: 'in_progress' });

      // Add 1 done task
      await request(app)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ title: 'Done 1', projectId: projId, status: 'done' });

      // Verify detail
      const detailRes = await request(app)
        .get(`/api/v1/projects/${projId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(detailRes.status).toBe(200);
      expect(detailRes.body.data.project.taskCounts).toEqual({
        open: 2,
        done: 1
      });

      // Verify list
      const listRes = await request(app)
        .get('/api/v1/projects')
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      expect(listRes.status).toBe(200);
      const found = listRes.body.data.find((p: { id: string }) => p.id === projId);
      expect(found.taskCounts).toEqual({ open: 2, done: 1 });
    });

    it('Project lifecycle: update, soft-delete, and restore within 30 days', async () => {
      const { tokens } = await registerUser();

      const projRes = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          name: 'Original Project Name',
          description: 'A great project'
        });
      const projId = projRes.body.data.project.id;

      // Update project
      const patchRes = await request(app)
        .patch(`/api/v1/projects/${projId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          name: 'Renamed Project',
          color: '#112233',
          version: projRes.body.data.project.version
        });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.project.name).toBe('Renamed Project');
      expect(patchRes.body.data.project.color).toBe('#112233');

      // Soft delete project
      const delRes = await request(app)
        .delete(`/api/v1/projects/${projId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(delRes.status).toBe(204);

      // Verify 404
      const getRes = await request(app)
        .get(`/api/v1/projects/${projId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(getRes.status).toBe(404);

      // Restore project
      const restoreRes = await request(app)
        .post(`/api/v1/projects/${projId}/restore`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(restoreRes.status).toBe(200);
      expect(restoreRes.body.data.project.id).toBe(projId);
      expect(restoreRes.body.data.project.name).toBe('Renamed Project');
    });
  });

  describe('Recurring Tasks Feature', () => {
    it('AC-REC-01: Creating recurring task idempotently generates first 7 days of instances in same transaction', async () => {
      const { user, tokens } = await registerUser();

      // Create a daily recurring task starting today
      const today = new Date().toISOString().slice(0, 10);

      const createRes = await request(app)
        .post('/api/v1/recurring-tasks')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Daily Standup Task',
          priority: 'medium',
          dueTime: '09:00',
          recurrence: {
            freq: 'daily',
            interval: 1,
            startDate: today
          }
        });

      expect(createRes.status).toBe(201);
      const recTaskId = createRes.body.data.recurringTask.id;
      expect(createRes.body.data.recurringTask.recurrence.freq).toBe('daily');

      // Check instances created in tasks table
      const tasksRes = await pool.query(
        `SELECT * FROM tasks WHERE recurring_task_id = $1 AND user_id = $2 ORDER BY occurrence_date ASC`,
        [recTaskId, user.id]
      );

      // Should have generated up to 8 instances (today .. today + 7 days)
      expect(tasksRes.rows.length).toBe(8);
      expect(tasksRes.rows[0].title).toBe('Daily Standup Task');
      expect(tasksRes.rows[0].priority).toBe(2);
      expect(tasksRes.rows[0].status).toBe('todo');
      expect(tasksRes.rows[0].is_customized).toBe(false);
    });

    it('AC-REC-02: Updating recurring template updates only future, non-customized, open instances; soft-delete preserves instances', async () => {
      const { user, tokens } = await registerUser();
      const today = new Date().toISOString().slice(0, 10);

      const createRes = await request(app)
        .post('/api/v1/recurring-tasks')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Template Original Title',
          priority: 'low',
          recurrence: {
            freq: 'daily',
            interval: 1,
            startDate: today
          }
        });

      const recTaskId = createRes.body.data.recurringTask.id;

      // Find future generated instances
      const instances = await pool.query(
        `SELECT id, occurrence_date, status, is_customized, title FROM tasks WHERE recurring_task_id = $1 AND user_id = $2 ORDER BY occurrence_date ASC`,
        [recTaskId, user.id]
      );

      expect(instances.rows.length).toBeGreaterThan(2);
      const todayInstance = instances.rows[0];
      const futureInstance1 = instances.rows[1];
      const futureInstance2 = instances.rows[2];

      // 1. Customize futureInstance1 via task PATCH
      const customizeRes = await request(app)
        .patch(`/api/v1/tasks/${futureInstance1.id}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Customized Task Title'
        });
      expect(customizeRes.status).toBe(200);

      // Verify customized flag in DB
      const checkCust = await pool.query('SELECT is_customized FROM tasks WHERE id = $1', [
        futureInstance1.id
      ]);
      expect(checkCust.rows[0].is_customized).toBe(true);

      // 2. Mark todayInstance as done
      await request(app)
        .patch(`/api/v1/tasks/${todayInstance.id}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ status: 'done' });

      // 3. Update the recurring template
      const updateTemplateRes = await request(app)
        .patch(`/api/v1/recurring-tasks/${recTaskId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Updated Template Title',
          priority: 'high'
        });

      expect(updateTemplateRes.status).toBe(200);

      // 4. Verify propagation per AC-REC-02:
      // - futureInstance2 (future, open, non-customized) -> updated to 'Updated Template Title'
      const checkFuture2 = await pool.query('SELECT title, priority FROM tasks WHERE id = $1', [
        futureInstance2.id
      ]);
      expect(checkFuture2.rows[0].title).toBe('Updated Template Title');
      expect(checkFuture2.rows[0].priority).toBe(3);

      // - futureInstance1 (customized) -> kept 'Customized Task Title'
      const checkFuture1 = await pool.query('SELECT title FROM tasks WHERE id = $1', [
        futureInstance1.id
      ]);
      expect(checkFuture1.rows[0].title).toBe('Customized Task Title');

      // - todayInstance (today / completed) -> stays as it was
      const checkToday = await pool.query('SELECT title, status FROM tasks WHERE id = $1', [
        todayInstance.id
      ]);
      expect(checkToday.rows[0].title).toBe('Template Original Title');
      expect(checkToday.rows[0].status).toBe('done');

      // 5. Soft-deleting template preserves already-generated instances
      const delRecRes = await request(app)
        .delete(`/api/v1/recurring-tasks/${recTaskId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(delRecRes.status).toBe(204);

      // Template is 404
      const getRec = await request(app)
        .get(`/api/v1/recurring-tasks/${recTaskId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(getRec.status).toBe(404);

      // Generated instances still exist and are active
      const remainingTasks = await pool.query(
        `SELECT COUNT(*) FROM tasks WHERE recurring_task_id = $1 AND deleted_at IS NULL`,
        [recTaskId]
      );
      expect(parseInt(remainingTasks.rows[0].count, 10)).toBeGreaterThan(0);
    });

    it('Recurring task lifecycle: list and get by ID', async () => {
      const { tokens } = await registerUser();
      const today = new Date().toISOString().slice(0, 10);

      const createRes = await request(app)
        .post('/api/v1/recurring-tasks')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          title: 'Recurring List Test',
          recurrence: {
            freq: 'weekly',
            interval: 1,
            byWeekday: [1, 3],
            startDate: today
          }
        });
      const recId = createRes.body.data.recurringTask.id;

      // GET by ID
      const getRes = await request(app)
        .get(`/api/v1/recurring-tasks/${recId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.data.recurringTask.title).toBe('Recurring List Test');
      expect(getRes.body.data.recurringTask.recurrence.byWeekday).toEqual([1, 3]);

      // List recurring tasks
      const listRes = await request(app)
        .get('/api/v1/recurring-tasks')
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Cross-Tenant Security', () => {
    it('User B cannot access or modify User A resources (tasks, projects, recurring tasks) - returns 404', async () => {
      const userA = await registerUser('usera@example.com');
      const userB = await registerUser('userb@example.com');

      // User A creates task, project, recurring task
      const taskA = await request(app)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${userA.tokens.accessToken}`)
        .send({ title: "User A's Task" });

      const projA = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${userA.tokens.accessToken}`)
        .send({ name: "User A's Project" });

      const recA = await request(app)
        .post('/api/v1/recurring-tasks')
        .set('Authorization', `Bearer ${userA.tokens.accessToken}`)
        .send({
          title: "User A's Rec Task",
          recurrence: {
            freq: 'daily',
            interval: 1,
            startDate: '2026-10-01'
          }
        });

      // User B tries to read User A's task -> 404
      const getTaskB = await request(app)
        .get(`/api/v1/tasks/${taskA.body.data.task.id}`)
        .set('Authorization', `Bearer ${userB.tokens.accessToken}`);
      expect(getTaskB.status).toBe(404);

      // User B tries to patch User A's task -> 404
      const patchTaskB = await request(app)
        .patch(`/api/v1/tasks/${taskA.body.data.task.id}`)
        .set('Authorization', `Bearer ${userB.tokens.accessToken}`)
        .send({ title: 'Hacked Title' });
      expect(patchTaskB.status).toBe(404);

      // User B tries to delete User A's task -> 404
      const delTaskB = await request(app)
        .delete(`/api/v1/tasks/${taskA.body.data.task.id}`)
        .set('Authorization', `Bearer ${userB.tokens.accessToken}`);
      expect(delTaskB.status).toBe(404);

      // User B tries to read User A's project -> 404
      const getProjB = await request(app)
        .get(`/api/v1/projects/${projA.body.data.project.id}`)
        .set('Authorization', `Bearer ${userB.tokens.accessToken}`);
      expect(getProjB.status).toBe(404);

      // User B tries to attach task to User A's project -> 404
      const attachB = await request(app)
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${userB.tokens.accessToken}`)
        .send({
          title: 'Sneaky Task',
          projectId: projA.body.data.project.id
        });
      expect(attachB.status).toBe(404);

      // User B tries to read User A's recurring task -> 404
      const getRecB = await request(app)
        .get(`/api/v1/recurring-tasks/${recA.body.data.recurringTask.id}`)
        .set('Authorization', `Bearer ${userB.tokens.accessToken}`);
      expect(getRecB.status).toBe(404);
    });
  });
});
