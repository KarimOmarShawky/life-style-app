import { Router, type RequestHandler } from 'express';
import type pg from 'pg';
import { AppError } from '../../core/errors/app-error.js';

/** Only old-client revocation remains; the server cannot issue or use ingest credentials. */
export function createRetiredIngestRouter(options: {
  pool: pg.Pool;
  authenticate: RequestHandler;
}): Router {
  const router = Router();
  router.delete('/token', options.authenticate, async (req, res, next) => {
    try {
      if (!req.sessionId) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      // Preserve ordering with an old server's in-flight issuance during rollout.
      // The session lock and update are committed together; this does not replace
      // the requirement to drain older writers before the erasure migration.
      const client = await options.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT id FROM auth_sessions WHERE id = $1 FOR UPDATE', [
          req.sessionId
        ]);
        await client.query(
          'UPDATE ingest_tokens SET revoked_at = now() WHERE session_id = $1 AND revoked_at IS NULL',
          [req.sessionId]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });
  return router;
}
