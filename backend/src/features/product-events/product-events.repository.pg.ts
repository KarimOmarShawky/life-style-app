/**
 * src/features/product-events/product-events.repository.pg.ts
 */

import type pg from 'pg';
import { logger } from '../../core/logger/logger.js';
import { isMissingSchemaObject } from '../../infrastructure/database/postgres/schema-capabilities.js';
import type { ProductEventsRepository } from './product-events.repository.js';
import type { ProductEventRecord } from './product-events.types.js';

let warnedUnavailable = false;

function noteUnavailable(): void {
  if (warnedUnavailable) return;
  warnedUnavailable = true;
  // No user data: only the fact that the owner-run DDL is still pending.
  logger.warn('Product events schema is not applied yet; events are not recorded');
}

export class PgProductEventsRepository implements ProductEventsRepository {
  constructor(private readonly pool: Pick<pg.Pool, 'query'>) {}

  public async record(event: ProductEventRecord): Promise<boolean> {
    try {
      // The opt-out and account status are checked in the same statement, so
      // a concurrent opt-out can never be followed by a late insert.
      const res = await this.pool.query(
        `INSERT INTO product_events (user_id, event_name, occurred_at, occurred_on, platform, app_version)
         SELECT u.id, $2, $3, $4, $5, $6
         FROM users u
         WHERE u.id = $1 AND u.product_events_enabled AND u.status = 'active'
         ON CONFLICT (user_id, event_name, occurred_on) DO NOTHING
         RETURNING id`,
        [
          event.userId,
          event.event,
          event.occurredAt,
          event.occurredOn,
          event.platform,
          event.appVersion
        ]
      );
      return (res.rowCount ?? 0) > 0;
    } catch (err) {
      if (isMissingSchemaObject(err)) {
        noteUnavailable();
        return false;
      }
      throw err;
    }
  }

  public async purgeOlderThan(cutoff: Date): Promise<number> {
    try {
      const res = await this.pool.query('DELETE FROM product_events WHERE occurred_at < $1', [
        cutoff
      ]);
      return res.rowCount ?? 0;
    } catch (err) {
      if (isMissingSchemaObject(err)) return 0;
      throw err;
    }
  }
}

/** Test hook: reset the one-time warning latch. */
export function resetProductEventsWarningForTests(): void {
  warnedUnavailable = false;
}
