/**
 * Audit trail writer (spec section 69).
 *
 * Every call is fire-and-forget on purpose: an audit write must never fail the
 * operation it is recording, and must never add its latency to the user's
 * request. A failure to write is logged loudly, because a silently broken audit
 * trail is worse than a noisy one.
 *
 * The trade-off is explicit: this favours availability of the feature over
 * completeness of the trail. For a personal productivity app that is the right
 * call. A system with a regulatory audit requirement would need the write to be
 * part of the transaction instead.
 */
import { getContext } from '@/core/logger';
import { createLogger } from '@/core/logger';

import { isMongoConnected } from './connection';
import {
  AuditLogModel,
  AuditAction,
  type AuditActionValue,
  type AuditOutcome,
} from './audit-log.model';

// Re-exported so callers import the action catalogue and the writer from one
// place, rather than reaching into the model file for a constant.
export { AuditAction };
export type { AuditActionValue, AuditOutcome };

const log = createLogger('audit');

export interface AuditEntryInput {
  readonly action: AuditActionValue;
  readonly outcome: AuditOutcome;
  readonly actorId?: string | null;
  readonly targetId?: string | null;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
  readonly metadata?: Record<string, unknown>;
}

export function recordAudit(entry: AuditEntryInput): void {
  const requestId = getContext()?.requestId ?? null;

  if (!isMongoConnected()) {
    // Still emit to the structured log so the event is not lost entirely when
    // MongoDB is unavailable.
    log.warn(
      { action: entry.action, outcome: entry.outcome, actorId: entry.actorId, requestId },
      'Audit entry not persisted: MongoDB unavailable',
    );
    return;
  }

  void AuditLogModel.create({
    action: entry.action,
    outcome: entry.outcome,
    actorId: entry.actorId ?? null,
    targetId: entry.targetId ?? null,
    ipAddress: entry.ipAddress ?? null,
    userAgent: entry.userAgent ?? null,
    requestId,
    metadata: entry.metadata ?? {},
  }).catch((error: unknown) => {
    log.error({ err: error, action: entry.action }, 'Failed to write audit entry');
  });
}
