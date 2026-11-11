/**
 * src/features/sessions/sessions.service.ts
 *
 * Feature guide G6 (ADR-047): the signed-in devices of the authenticated
 * account, and signing one of them out.
 * - Ownership always comes from the authenticated session. Another account's
 *   session id is answered exactly like an unknown id (404).
 * - Revoking checks the current password first (shared re-authentication
 *   budget), then ends the session, its refresh tokens and its push devices.
 *   Repeating it is harmless.
 * - Responses carry device metadata only: no IP address, token or hash.
 */

import { AppError } from '../../core/errors/app-error.js';
import type { AuditLogger } from '../../infrastructure/database/postgres/audit-logger.js';
import {
  SESSION_LIST_LIMIT,
  type SessionRow,
  type SessionsRepository
} from './sessions.repository.pg.js';

export interface SessionDto {
  id: string;
  devicePlatform: 'ios' | 'android' | 'unknown';
  deviceName: string | null;
  appVersion: string | null;
  createdAt: string;
  lastUsedAt: string;
  /** The session that made this request. */
  current: boolean;
}

export interface SessionListDto {
  sessions: SessionDto[];
  /** More active sessions exist than were listed. */
  truncated: boolean;
}

export interface SessionRevokeDto {
  revoked: true;
  /** The caller signed out its own session: the app should finish signing out. */
  current: boolean;
}

export interface SessionRequestMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
}

export type Reauthenticate = (userId: string, currentPassword: string) => Promise<void>;

export function toSessionDto(row: SessionRow, currentSessionId: string | undefined): SessionDto {
  return {
    id: row.id,
    devicePlatform: row.device_platform,
    deviceName: row.device_name,
    appVersion: row.app_version,
    createdAt: new Date(row.created_at).toISOString(),
    lastUsedAt: new Date(row.last_used_at).toISOString(),
    current: row.id === currentSessionId
  };
}

export class SessionsService {
  constructor(
    private readonly repo: SessionsRepository,
    private readonly reauthenticate: Reauthenticate,
    private readonly auditLogger: AuditLogger
  ) {}

  public async list(userId: string, currentSessionId: string | undefined): Promise<SessionListDto> {
    const rows = await this.repo.listActive(
      userId,
      currentSessionId ?? null,
      SESSION_LIST_LIMIT + 1
    );
    return {
      sessions: rows.slice(0, SESSION_LIST_LIMIT).map((row) => toSessionDto(row, currentSessionId)),
      truncated: rows.length > SESSION_LIST_LIMIT
    };
  }

  public async revoke(input: {
    userId: string;
    currentSessionId: string | undefined;
    sessionId: string;
    currentPassword: string;
    meta?: SessionRequestMeta | undefined;
  }): Promise<SessionRevokeDto> {
    await this.reauthenticate(input.userId, input.currentPassword);
    const result = await this.repo.revoke(input.userId, input.sessionId);
    if (result.outcome === 'not_found') {
      throw AppError.notFound('Session not found');
    }
    const current = input.sessionId === input.currentSessionId;
    await this.auditLogger.log({
      actorType: 'user',
      actorUserId: input.userId,
      sessionId: input.currentSessionId ?? null,
      eventType: 'auth.session.revoke',
      outcome: 'success',
      entityType: 'auth_session',
      entityId: input.sessionId,
      requestId: input.meta?.requestId,
      ip: input.meta?.ip,
      userAgent: input.meta?.userAgent,
      metadata: {
        current,
        alreadyEnded: result.outcome === 'already_ended',
        reason: result.outcome === 'revoked' ? result.reason : null
      }
    });
    return { revoked: true, current };
  }
}
