/**
 * src/infrastructure/database/postgres/audit-logger.ts
 *
 * Implements Section 6.9, 8.6 & 13: Append-only PostgreSQL Audit Logger.
 * Records authentication events, security anomalies, and financial mutations.
 * Strictly forbids recording passwords, raw tokens, codes, or note content in metadata.
 */

import type pg from 'pg';
import { logger } from '../../../core/logger/logger.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeAuditRequestId(
  requestId: string | null | undefined,
  metadata?: Record<string, unknown> | undefined
): { uuidRequestId: string | null; metadata: Record<string, unknown> } {
  const baseMeta = metadata ? { ...metadata } : {};
  if (!requestId) {
    return { uuidRequestId: null, metadata: baseMeta };
  }
  if (UUID_REGEX.test(requestId)) {
    return { uuidRequestId: requestId, metadata: baseMeta };
  }
  baseMeta.clientRequestId = requestId.slice(0, 64);
  return { uuidRequestId: null, metadata: baseMeta };
}

export interface AuditEvent {
  actorType: 'user' | 'system';
  actorUserId?: string | null | undefined;
  sessionId?: string | null | undefined;
  eventType: string;
  outcome: 'success' | 'failure';
  entityType?: string | null | undefined;
  entityId?: string | null | undefined;
  requestId?: string | null | undefined;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface AuditLogger {
  log(event: AuditEvent): Promise<void>;
}

export class PgAuditLogger implements AuditLogger {
  constructor(private readonly pool: pg.Pool) {}

  public async log(event: AuditEvent): Promise<void> {
    const query = `
      INSERT INTO audit_logs (
        actor_type, actor_user_id, session_id, event_type, outcome,
        entity_type, entity_id, request_id, ip, user_agent, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
    `;

    const normalized = normalizeAuditRequestId(event.requestId, event.metadata);

    const values = [
      event.actorType,
      event.actorUserId ?? null,
      event.sessionId ?? null,
      event.eventType,
      event.outcome,
      event.entityType ?? null,
      event.entityId ?? null,
      normalized.uuidRequestId,
      event.ip ?? null,
      event.userAgent ? event.userAgent.slice(0, 300) : null,
      JSON.stringify(normalized.metadata)
    ];

    try {
      await this.pool.query(query, values);
    } catch (err) {
      logger.error('Failed to append audit log entry', err, { eventType: event.eventType });
    }
  }
}
