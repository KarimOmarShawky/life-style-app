import '../infrastructure-safety.js';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseSchema } from '../../src/infrastructure/database/postgres/kysely.js';
import { globalErrorHandler } from '../../src/core/middleware/error-handler.js';
import { baseLogger, logger } from '../../src/core/logger/logger.js';
import { summarizeErrorForLog } from '../../src/core/logger/log-minimization.js';
import { WalletSessionStore } from '../../src/features/wallet-auth/wallet-session-store.pg.js';
import { WalletRecordCipher } from '../../src/features/wallet-auth/wallet-record-cipher.js';
import { WalletOwnedRecordStore } from '../../src/features/wallet-auth/wallet-owned-record-store.pg.js';

// Synthetic data only: PostgreSQL itself may log the failed row. This test
// verifies the application log boundary, not the database server's log policy.
describe('wallet PostgreSQL error application-log boundary', () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const db = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });
  const sessions = new WalletSessionStore(db);
  afterAll(async () => db.destroy());

  it('does not forward a real PostgreSQL failed-row detail to application logs or HTTP', async () => {
    const a = await sessions.create();
    const synthetic = 'synthetic-wallet-payload';
    const hex = Buffer.from(synthetic).toString('hex');
    let failure: unknown;
    try {
      await pool.query(
        `INSERT INTO wallet_owned_records (wallet_account_id, id, kind, envelope)
         VALUES ($1, $2, 'invalid-kind', $3)`,
        [a.walletAccountId, randomUUID(), Buffer.from(synthetic)]
      );
      throw new Error('Expected a database constraint error');
    } catch (error) {
      failure = error;
    }
    try {
      expect(failure).toMatchObject({ code: '23514' });
      expect((failure as { detail?: string }).detail).toContain(hex);
      expect(JSON.stringify(summarizeErrorForLog(failure))).not.toContain(hex);

      const errorSink = vi.spyOn(baseLogger, 'error').mockImplementation(() => undefined as never);
      const fatalSink = vi.spyOn(baseLogger, 'fatal').mockImplementation(() => undefined as never);
      try {
        const app = express();
        app.use(() => {
          throw failure;
        });
        app.use(globalErrorHandler);
        const response = await request(app).get(`/sensitive/${synthetic}`);
        expect(response.status).toBe(400);
        logger.fatal('Synthetic database failure', failure);
        const output = JSON.stringify([response.body, errorSink.mock.calls, fatalSink.mock.calls]);
        expect(output).not.toContain(hex);
        expect(output).not.toContain(synthetic);
        expect(output).toContain('23514');
      } finally {
        errorSink.mockRestore();
        fatalSink.mockRestore();
      }
    } finally {
      await sessions.revoke(a.credential.token);
    }
  });
  it('stores encrypted bytes on the repository path even when the input is synthetic plaintext', async () => {
    const a = await sessions.create();
    const id = randomUUID();
    const marker = 'synthetic-wallet-sensitive-payload';
    const input = Buffer.from(marker);
    const store = new WalletOwnedRecordStore(sessions, new WalletRecordCipher(randomBytes(32)));
    try {
      expect(await store.put(a.credential.token, id, 'review', input)).toEqual({
        authenticated: true,
        value: 'created'
      });
      const result = await pool.query<{ envelope: Buffer }>(
        'SELECT envelope FROM wallet_owned_records WHERE wallet_account_id = $1 AND id = $2',
        [a.walletAccountId, id]
      );
      const encrypted = result.rows[0]!.envelope;
      expect(encrypted.includes(input)).toBe(false);
      let failure: unknown;
      try {
        await pool.query(
          `INSERT INTO wallet_owned_records (wallet_account_id, id, kind, envelope)
           VALUES ($1, $2, 'invalid-kind', $3)`,
          [a.walletAccountId, randomUUID(), encrypted]
        );
        throw new Error('Expected a database constraint error');
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({ code: '23514' });
      const detail = (failure as { detail: string }).detail;
      expect(detail).not.toContain(marker);
      expect(detail).not.toContain(input.toString('hex'));
      // This demonstrates the tested path only, not protection from raw SQL,
      // SQL/parameter logs, other sinks, metadata or server-side plaintext.
    } finally {
      await sessions.revoke(a.credential.token);
    }
  });
});
