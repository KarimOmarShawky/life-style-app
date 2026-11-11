/**
 * src/features/ai-reports/ai-reports.service.ts
 *
 * Stores user reports of AI output (AI-P). Reports are the only place where
 * AI reply text is ever stored, and only when the user ticked "include the
 * reply". They are kept for AI_REPORT_RETENTION_DAYS, erased with the account
 * and included in the JSON export. Report contents are never logged.
 */

import { AppError } from '../../core/errors/app-error.js';
import type { Clock } from '../../core/time/clock.js';
import type { AiReportsRepository } from './ai-reports.repository.js';
import type { CreateAiReportInput } from './ai-reports.types.js';

/** Reports older than this are deleted by the nightly retention job. */
export const AI_REPORT_RETENTION_DAYS = 90;

export class AiReportsService {
  constructor(
    private readonly repo: AiReportsRepository,
    private readonly clock: Clock
  ) {}

  public async create(userId: string, input: CreateAiReportInput): Promise<{ reported: true }> {
    const result = await this.repo.create({
      userId,
      surface: input.surface,
      category: input.category,
      replyText: input.replyText ?? null,
      note: input.note ?? null,
      locale: input.locale
    });
    if (!result.available) {
      throw new AppError({
        httpStatus: 503,
        code: 'AI_REPORTS_UNAVAILABLE',
        safeMessage: 'Reports cannot be sent yet. Please try again later.',
        isOperational: true
      });
    }
    if (!result.created) {
      throw AppError.notFound('Account not found');
    }
    return { reported: true };
  }

  public async purgeExpired(retentionDays = AI_REPORT_RETENTION_DAYS): Promise<number> {
    const cutoff = new Date(this.clock.now().getTime() - retentionDays * 86_400_000);
    return this.repo.purgeOlderThan(cutoff);
  }
}
