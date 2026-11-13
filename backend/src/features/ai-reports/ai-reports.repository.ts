/**
 * src/features/ai-reports/ai-reports.repository.ts
 */

import type { AiReportRecord, AiReportWriteResult } from './ai-reports.types.js';

export interface AiReportsRepository {
  /**
   * Inserts one report for an active account. `available` is false while the
   * owner-run DDL is still pending; `created` is false when the account is
   * missing or not active.
   */
  create(report: AiReportRecord): Promise<AiReportWriteResult>;
  /** Retention: hard-deletes reports created before `cutoff`. */
  purgeOlderThan(cutoff: Date): Promise<number>;
}
