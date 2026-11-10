/**
 * src/features/product-events/product-events.service.ts
 *
 * Records content-free product events (G5). The server stamps the time and
 * derives the user's local calendar day; clients cannot backdate events.
 * Recording is best-effort by design: when the kill switch is off, the
 * account opted out, the event was already recorded today, or the schema is
 * not yet applied, the request still succeeds with `recorded: false`, so a
 * telemetry problem can never break a user flow.
 */

import type { Clock } from '../../core/time/clock.js';
import { getUserTodayDate } from '../../core/time/date-utils.js';
import type { ProductEventsRepository } from './product-events.repository.js';
import type { RecordProductEventInput } from './product-events.types.js';

/** Events older than this are deleted by the nightly retention job. */
export const PRODUCT_EVENT_RETENTION_DAYS = 400;

export class ProductEventsService {
  constructor(
    private readonly repo: ProductEventsRepository,
    private readonly clock: Clock,
    private readonly enabled: boolean
  ) {}

  public async record(
    userId: string,
    timezone: string,
    input: RecordProductEventInput
  ): Promise<{ recorded: boolean }> {
    if (!this.enabled) return { recorded: false };
    const occurredAt = this.clock.now();
    const recorded = await this.repo.record({
      userId,
      event: input.event,
      platform: input.platform,
      appVersion: input.appVersion ?? null,
      occurredAt,
      occurredOn: getUserTodayDate(timezone || 'UTC', occurredAt)
    });
    return { recorded };
  }

  public async purgeExpired(retentionDays = PRODUCT_EVENT_RETENTION_DAYS): Promise<number> {
    const cutoff = new Date(this.clock.now().getTime() - retentionDays * 86_400_000);
    return this.repo.purgeOlderThan(cutoff);
  }
}
