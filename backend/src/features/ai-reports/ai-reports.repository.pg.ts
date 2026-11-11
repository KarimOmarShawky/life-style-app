/**
 * src/features/ai-reports/ai-reports.repository.pg.ts
 */

import type pg from 'pg';
import { logger } from '../../core/logger/logger.js';
import { isMissingSchemaObject } from '../../infrastructure/database/postgres/schema-capabilities.js';
import type { AiReportsRepository } from './ai-reports.repository.js';
import type { AiReportRecord, AiReportWriteResult } from './ai-reports.types.js';

let warnedUnavailable = false;

function noteUnavailable(): void {
  if (warnedUnavailable) return;
  warnedUnavailable = true;
  // No user data: only the fact that the owner-run DDL is still pending.
  logger.warn('AI content reports schema is not applied yet; reports are refused');
}

export class PgAiReportsRepository implements AiReportsRepository {
  constructor(private readonly pool: Pick<pg.Pool, 'query'>) {}

  public async create(report: AiReportRecord): Promise<AiReportWriteResult> {
    try {
      // The account status is checked in the same statement, so a report can
      // never be written for an account that is being deleted.
      const res = await this.pool.query(
        `INSERT INTO ai_content_reports (user_id, surface, category, reply_text, note, locale)
         SELECT u.id, $2, $3, $4, $5, $6
         FROM users u
         WHERE u.id = $1 AND u.status = 'active'
         RETURNING id`,
        [
          report.userId,
          report.surface,
          report.category,
          report.replyText,
          report.note,
          report.locale
        ]
      );
      return { available: true, created: (res.rowCount ?? 0) > 0 };
    } catch (err) {
      if (isMissingSchemaObject(err)) {
        noteUnavailable();
        return { available: false, created: false };
      }
      throw err;
    }
  }

  public async purgeOlderThan(cutoff: Date): Promise<number> {
    try {
      const res = await this.pool.query('DELETE FROM ai_content_reports WHERE created_at < $1', [
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
export function resetAiReportsWarningForTests(): void {
  warnedUnavailable = false;
}
