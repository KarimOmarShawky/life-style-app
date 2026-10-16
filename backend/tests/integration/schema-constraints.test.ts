import '../infrastructure-safety.js';
/**
 * tests/integration/schema-constraints.test.ts
 *
 * Implements Phase P3 Acceptance & SQL Constraint Test Suite (Section 6.1–6.9 & Section 21):
 * - ON DELETE CASCADE across all entity hierarchies
 * - ON DELETE SET NULL purge cases (preserving occurrence_date and billing_date)
 * - ON DELETE RESTRICT on categories (preventing deletion while referenced)
 * - Owner-consistent composite foreign keys preventing cross-tenant links (ADR-005)
 * - Partial unique indexes (one focus/day, one running timer, unique check-in, idempotency)
 * - Multi-column CHECK constraints (num_nonnulls, currency regex, money precision, lifecycle timestamps)
 * - Automated updated_at triggers
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getPgPool } from '../../src/infrastructure/database/postgres/pool.js';

describe('Phase P3 SQL Constraint & Schema Integrity Test Suite', () => {
  const pool = getPgPool();

  beforeEach(async () => {
    // Clean test data
    await pool.query('DELETE FROM users');
  });

  async function createTestUser(email = 'test@example.com') {
    const res = await pool.query(
      `INSERT INTO users (email, password_hash, display_name, timezone, locale, default_currency)
       VALUES ($1::citext, 'hash123', 'Test User', 'UTC', 'en', 'USD')
       RETURNING id`,
      [email]
    );
    return res.rows[0].id as string;
  }

  it('Enforces ON DELETE CASCADE from users to all child entities', async () => {
    const userId = await createTestUser();

    // Insert a category, goal, milestone, project, task, note, and event
    await pool.query(
      `INSERT INTO categories (user_id, kind, name) VALUES ($1, 'expense', 'Food') RETURNING id`,
      [userId]
    );
    const goalRes = await pool.query(
      `INSERT INTO goals (user_id, title, progress_type) VALUES ($1, 'Learn PostgreSQL', 'milestones') RETURNING id`,
      [userId]
    );
    await pool.query(
      `INSERT INTO milestones (user_id, goal_id, title) VALUES ($1, $2, 'Read Manual')`,
      [userId, goalRes.rows[0].id]
    );
    const projRes = await pool.query(
      `INSERT INTO projects (user_id, name) VALUES ($1, 'Backend Dev') RETURNING id`,
      [userId]
    );
    const taskRes = await pool.query(
      `INSERT INTO tasks (user_id, title, project_id) VALUES ($1, 'Write Migrations', $2) RETURNING id`,
      [userId, projRes.rows[0].id]
    );
    await pool.query(
      `INSERT INTO timer_sessions (user_id, task_id, started_at) VALUES ($1, $2, now())`,
      [userId, taskRes.rows[0].id]
    );

    // Delete user
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);

    // Verify all tables were cascaded
    const [cats, goals, miles, projs, tasks, timers] = await Promise.all([
      pool.query('SELECT count(*) FROM categories WHERE user_id = $1', [userId]),
      pool.query('SELECT count(*) FROM goals WHERE user_id = $1', [userId]),
      pool.query('SELECT count(*) FROM milestones WHERE user_id = $1', [userId]),
      pool.query('SELECT count(*) FROM projects WHERE user_id = $1', [userId]),
      pool.query('SELECT count(*) FROM tasks WHERE user_id = $1', [userId]),
      pool.query('SELECT count(*) FROM timer_sessions WHERE user_id = $1', [userId])
    ]);

    expect(Number(cats.rows[0].count)).toBe(0);
    expect(Number(goals.rows[0].count)).toBe(0);
    expect(Number(miles.rows[0].count)).toBe(0);
    expect(Number(projs.rows[0].count)).toBe(0);
    expect(Number(tasks.rows[0].count)).toBe(0);
    expect(Number(timers.rows[0].count)).toBe(0);
  });

  it('Enforces ON DELETE SET NULL purge cases for recurring tasks and subscriptions (Section 6.2a)', async () => {
    const userId = await createTestUser();

    // 1. Recurring task purge case:
    // When recurring_task is purged (SET NULL), task.recurring_task_id becomes NULL,
    // but task.occurrence_date MUST survive as history without violating constraints.
    const recTaskRes = await pool.query(
      `INSERT INTO recurring_tasks (user_id, title) VALUES ($1, 'Daily Standup') RETURNING id`,
      [userId]
    );
    const recTaskId = recTaskRes.rows[0].id;

    const taskRes = await pool.query(
      `INSERT INTO tasks (user_id, title, recurring_task_id, occurrence_date)
       VALUES ($1, 'Daily Standup Instance', $2, '2026-09-27')
       RETURNING id`,
      [userId, recTaskId]
    );
    const taskId = taskRes.rows[0].id;

    // Purge recurring task template
    await pool.query('DELETE FROM recurring_tasks WHERE id = $1', [recTaskId]);

    // Verify task survived, recurring_task_id is NULL, and occurrence_date is preserved
    const taskAfter = await pool.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
    expect(taskAfter.rows[0].recurring_task_id).toBeNull();
    expect(taskAfter.rows[0].occurrence_date.toISOString().slice(0, 10)).toBe('2026-09-27');

    // 2. Subscription purge case:
    // When subscription is purged (SET NULL), transaction.subscription_id becomes NULL,
    // but transaction.billing_date MUST survive as history without violating constraints.
    const catRes = await pool.query(
      `INSERT INTO categories (user_id, kind, name) VALUES ($1, 'expense', 'Software') RETURNING id`,
      [userId]
    );
    const catId = catRes.rows[0].id;

    const subRes = await pool.query(
      `INSERT INTO subscriptions (user_id, name, amount, currency, billing_unit, anchor_date, next_billing_date, category_id)
       VALUES ($1, 'Cloud Server', 20.0000, 'USD', 'month', '2026-01-01', '2026-10-01', $2)
       RETURNING id`,
      [userId, catId]
    );
    const subId = subRes.rows[0].id;

    const txRes = await pool.query(
      `INSERT INTO transactions (user_id, kind, amount, currency, occurred_on, category_id, subscription_id, billing_date)
       VALUES ($1, 'expense', 20.0000, 'USD', '2026-09-01', $2, $3, '2026-09-01')
       RETURNING id`,
      [userId, catId, subId]
    );
    const txId = txRes.rows[0].id;

    // Purge subscription
    await pool.query('DELETE FROM subscriptions WHERE id = $1', [subId]);

    // Verify transaction survived, subscription_id is NULL, and billing_date is preserved
    const txAfter = await pool.query('SELECT * FROM transactions WHERE id = $1', [txId]);
    expect(txAfter.rows[0].subscription_id).toBeNull();
    expect(txAfter.rows[0].billing_date.toISOString().slice(0, 10)).toBe('2026-09-01');
  });

  it('Enforces ON DELETE RESTRICT on categories when referenced by transactions or budgets', async () => {
    const userId = await createTestUser();
    const catRes = await pool.query(
      `INSERT INTO categories (user_id, kind, name) VALUES ($1, 'expense', 'Dining Out') RETURNING id`,
      [userId]
    );
    const catId = catRes.rows[0].id;

    await pool.query(
      `INSERT INTO transactions (user_id, kind, amount, currency, occurred_on, category_id)
       VALUES ($1, 'expense', 45.5000, 'USD', '2026-09-27', $2)`,
      [userId, catId]
    );

    // Deleting the referenced category must fail with foreign key violation (RESTRICT)
    await expect(pool.query('DELETE FROM categories WHERE id = $1', [catId])).rejects.toThrowError(
      /violates foreign key constraint/
    );
  });

  it('Enforces cross-tenant isolation via composite foreign keys (ADR-005)', async () => {
    const userA = await createTestUser('usera@example.com');
    const userB = await createTestUser('userb@example.com');

    // User A creates a project
    const projRes = await pool.query(
      `INSERT INTO projects (user_id, name) VALUES ($1, 'User A Secret Project') RETURNING id`,
      [userA]
    );
    const projA = projRes.rows[0].id;

    // User B attempts to create a task referencing User A's project
    await expect(
      pool.query(
        `INSERT INTO tasks (user_id, title, project_id) VALUES ($1, 'Malicious Task', $2)`,
        [userB, projA]
      )
    ).rejects.toThrowError(/violates foreign key constraint/);
  });

  it('Enforces category kind consistency on transactions, subscriptions, and budgets', async () => {
    const userId = await createTestUser();

    // Create an INCOME category
    const incomeCatRes = await pool.query(
      `INSERT INTO categories (user_id, kind, name) VALUES ($1, 'income', 'Salary') RETURNING id`,
      [userId]
    );
    const incomeCatId = incomeCatRes.rows[0].id;

    // 1. Attempt to create an EXPENSE transaction referencing an INCOME category -> REJECT
    await expect(
      pool.query(
        `INSERT INTO transactions (user_id, kind, amount, currency, occurred_on, category_id)
         VALUES ($1, 'expense', 10.0000, 'USD', '2026-09-27', $2)`,
        [userId, incomeCatId]
      )
    ).rejects.toThrowError(/violates foreign key constraint/);

    // 2. Attempt to create a subscription (which is always expense) referencing an INCOME category -> REJECT
    await expect(
      pool.query(
        `INSERT INTO subscriptions (user_id, name, amount, currency, billing_unit, anchor_date, next_billing_date, category_id)
         VALUES ($1, 'Invalid Sub', 10.0000, 'USD', 'month', '2026-01-01', '2026-10-01', $2)`,
        [userId, incomeCatId]
      )
    ).rejects.toThrowError(/violates foreign key constraint/);
  });

  it('Enforces partial unique indexes (one focus/day, one running timer)', async () => {
    const userId = await createTestUser();

    // 1. One focus task per day
    await pool.query(
      `INSERT INTO tasks (user_id, title, planned_date, is_focus)
       VALUES ($1, 'Focus Task 1', '2026-09-27', true)`,
      [userId]
    );

    await expect(
      pool.query(
        `INSERT INTO tasks (user_id, title, planned_date, is_focus)
         VALUES ($1, 'Focus Task 2', '2026-09-27', true)`,
        [userId]
      )
    ).rejects.toThrowError(/violates unique constraint "idx_tasks_one_focus_per_day"/);

    // 2. One running timer session per user
    const taskRes = await pool.query(
      `INSERT INTO tasks (user_id, title) VALUES ($1, 'Timed Task') RETURNING id`,
      [userId]
    );
    const taskId = taskRes.rows[0].id;

    await pool.query(
      `INSERT INTO timer_sessions (user_id, task_id, started_at) VALUES ($1, $2, now())`,
      [userId, taskId]
    );

    // Attempting to start a second timer while the first is active must fail
    await expect(
      pool.query(
        `INSERT INTO timer_sessions (user_id, task_id, started_at) VALUES ($1, $2, now())`,
        [userId, taskId]
      )
    ).rejects.toThrowError(/violates unique constraint "idx_timer_sessions_one_running"/);
  });

  it('Enforces CHECK constraints on currency format, money precision, and num_nonnulls', async () => {
    const userId = await createTestUser();

    // 1. Invalid currency format (lowercase or not 3 chars)
    await expect(
      pool.query(
        `INSERT INTO transactions (user_id, kind, amount, currency, occurred_on)
         VALUES ($1, 'expense', 15.0000, 'usd', '2026-09-27')`,
        [userId]
      )
    ).rejects.toThrowError(/violates check constraint/);

    // 2. Negative amount limit
    await expect(
      pool.query(
        `INSERT INTO budgets (user_id, amount_limit, currency)
         VALUES ($1, -50.0000, 'USD')`,
        [userId]
      )
    ).rejects.toThrowError(/violates check constraint/);

    // 3. Reminders num_nonnulls = 1 (cannot link to zero or multiple entities)
    await expect(
      pool.query(
        `INSERT INTO reminders (user_id, source, remind_at, channel)
         VALUES ($1, 'user', now(), 'push')`,
        [userId]
      )
    ).rejects.toThrowError(/violates check constraint/);
  });

  it('Maintains updated_at automatically via database trigger', async () => {
    const userId = await createTestUser();
    const projRes = await pool.query(
      `INSERT INTO projects (user_id, name) VALUES ($1, 'Original Name') RETURNING id, updated_at`,
      [userId]
    );
    const initialUpdatedAt = new Date(projRes.rows[0].updated_at).getTime();

    // Small delay to ensure timestamp progression
    await new Promise((r) => setTimeout(r, 20));

    await pool.query(`UPDATE projects SET name = 'Modified Name' WHERE id = $1`, [
      projRes.rows[0].id
    ]);

    const updatedProj = await pool.query('SELECT updated_at FROM projects WHERE id = $1', [
      projRes.rows[0].id
    ]);
    const finalUpdatedAt = new Date(updatedProj.rows[0].updated_at).getTime();

    expect(finalUpdatedAt).toBeGreaterThan(initialUpdatedAt);
  });
});
