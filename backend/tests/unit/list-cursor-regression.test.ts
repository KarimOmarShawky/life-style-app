import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { PgHabitsRepository } from '../../src/features/habits/habits.repository.pg.js';
import { PgProjectsRepository } from '../../src/features/projects/projects.repository.pg.js';
import { PgRecurringTasksRepository } from '../../src/features/recurring-tasks/recurring-tasks.repository.pg.js';
import { globalErrorHandler } from '../../src/core/middleware/error-handler.js';

function database() {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['selectAll', 'where', 'orderBy', 'limit']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.execute = vi.fn(async () => []);
  return { selectFrom: () => builder, builder };
}

describe('list cursor validation', () => {
  for (const [name, Repository] of [
    ['habits', PgHabitsRepository],
    ['projects', PgProjectsRepository],
    ['recurring tasks', PgRecurringTasksRepository]
  ] as const) {
    it(`rejects invalid ${name} cursors before executing SQL`, async () => {
      const db = database();
      const repository = new Repository(db as never);
      for (const cursor of [
        'not-json!',
        Buffer.from(
          JSON.stringify({ id: 'not-a-uuid', createdAt: '2026-01-01T00:00:00.000Z' })
        ).toString('base64'),
        Buffer.from(
          JSON.stringify({ id: 'd9b73678-75f1-432a-bc91-231362095cb7', createdAt: 'bad' })
        ).toString('base64')
      ]) {
        await expect(repository.list('u', undefined, 25, cursor)).rejects.toMatchObject({
          httpStatus: 400,
          details: [expect.objectContaining({ field: 'cursor' })]
        });
      }
      expect(db.builder.execute).not.toHaveBeenCalled();
    });
  }
  it('maps invalid PostgreSQL text representation to a safe 400', async () => {
    const app = express();
    app.get('/', (_req, _res, next) =>
      next(Object.assign(new Error('sensitive'), { code: '22P02' }))
    );
    app.use(globalErrorHandler);
    const response = await request(app).get('/');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(response.body)).not.toContain('sensitive');
  });
});
