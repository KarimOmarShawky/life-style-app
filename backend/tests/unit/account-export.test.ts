import { describe, it, expect, vi } from 'vitest';
import type pg from 'pg';
import { PgUsersRepository } from '../../src/features/users/users.repository.pg.js';

function fixture(missing = false, overflow = '') {
  const query = vi.fn(async (sql: string, _params: unknown[]) => ({
    rows:
      sql.includes('FROM users') && !missing
        ? [
            {
              id: 'user-1',
              email: 'unit@example.test',
              display_name: 'Unit',
              timezone: 'UTC',
              locale: 'en',
              week_start: 1,
              default_currency: 'USD',
              status: 'active',
              created_at: new Date('2026-01-01T00:00:00Z')
            }
          ]
        : overflow && sql.includes(`FROM ${overflow} `)
          ? Array.from({ length: 1001 }, () => ({}))
          : []
  }));
  return { repo: new PgUsersRepository({ query } as unknown as pg.Pool), query };
}

describe('Legacy account metadata export (SQL harness, not a live database)', () => {
  it('handles a user deleted between authentication and export without secondary queries', async () => {
    const { repo, query } = fixture(true);
    await expect(repo.getUserExportData('deleted-user')).rejects.toMatchObject({
      httpStatus: 404,
      code: 'NOT_FOUND'
    });
    expect(query).toHaveBeenCalledOnce();
  });

  it('selects only metadata columns and scopes every query to the authenticated identity', async () => {
    const { repo, query } = fixture();
    const result = await repo.getUserExportData('user-1');
    expect(result).toMatchObject({
      profile: { id: 'user-1', email: 'unit@example.test', createdAt: '2026-01-01T00:00:00.000Z' },
      sessions: [],
      categories: [],
      pushDevices: []
    });
    expect(Object.keys(result).sort()).toEqual(
      ['exportedAt', 'profile', 'sessions', 'categories', 'pushDevices'].sort()
    );
    expect(query).toHaveBeenCalledTimes(4);
    for (const [sql, params] of query.mock.calls) {
      expect(params).toEqual(['user-1']);
      expect(sql).toMatch(/WHERE (?:user_id|id) = \$1/);
      expect(sql).not.toMatch(/SELECT\s+\*|password|token_hash|push_token/i);
    }
    expect(result.profile).not.toHaveProperty('password_hash');
  });
  for (const table of ['auth_sessions', 'categories', 'push_devices']) {
    it(`rejects oversized ${table} metadata rather than returning silent partial success`, async () => {
      const { repo, query } = fixture(false, table);
      await expect(repo.getUserExportData('user-1')).rejects.toMatchObject({
        httpStatus: 413,
        code: 'PAYLOAD_TOO_LARGE'
      });
      for (const [sql] of query.mock.calls.slice(1)) expect(sql).toContain('LIMIT 1001');
    });
  }
});
