import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The owner SQL for deletion requests received outside the app
// (docs/auth/account-deletion-requests.md) must keep doing what the app does.
const repository = readFileSync('src/features/users/users.repository.pg.ts', 'utf8');
const service = readFileSync('src/features/users/users.service.ts', 'utf8');
const ownerSql = readFileSync('../docs/auth/sql/schedule-account-deletion-on-request.sql', 'utf8');

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe('owner SQL for account deletion requests', () => {
  it('repeats every statement of the in-app scheduling', () => {
    const scheduling = between(
      repository,
      'public async scheduleDeletion(',
      'public async cancelDeletion('
    );
    const statements = [
      "SET status = 'pending_deletion', deletion_scheduled_for",
      'UPDATE ingest_tokens SET revoked_at = now()',
      'DELETE FROM push_devices',
      "SET status = 'cancelled', next_attempt_at = NULL",
      "status IN ('pending', 'processing')",
      "SET revoked_at = now(), revoked_reason = 'account_deletion'",
      'UPDATE refresh_tokens'
    ];
    for (const statement of statements) {
      expect(scheduling).toContain(statement);
      expect(ownerSql).toContain(statement);
    }
  });

  it('keeps the 14-day window, an existing date and the audit event', () => {
    expect(service).toContain('14 * 24 * 60 * 60 * 1000');
    expect(ownerSql).toContain("now() + interval '14 days'");
    expect(repository).toContain("existing.status === 'pending_deletion'");
    expect(ownerSql).toContain("v_status = 'pending_deletion' AND v_scheduled IS NOT NULL");
    expect(service).toContain("eventType: 'user.deletion.requested'");
    expect(ownerSql).toContain("'system', v_user, 'user.deletion.requested', 'success'");
  });

  it('acts on exactly one account and holds no real address', () => {
    expect(ownerSql).toContain('IF v_count <> 1 THEN');
    expect(ownerSql).toContain('FOR UPDATE');
    const addresses = ownerSql.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [];
    expect(new Set(addresses)).toEqual(new Set(['person@example.com']));
  });
});
