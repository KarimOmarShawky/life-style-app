/**
 * src/features/ingest/ingest.repository.ts
 *
 * Storage contract for session-bound ingest tokens. Each session has at most one active token.
 */

export interface IngestTokenRecord {
  id: string;
  userId: string;
  sessionId: string;
}

export interface IngestTokenRepository {
  /** Revokes the session's active token, if any, and stores the new digest in one transaction. */
  replaceForSession(input: { userId: string; sessionId: string; tokenHash: Buffer }): Promise<void>;
  revokeForSession(sessionId: string): Promise<void>;
  findActiveByHash(tokenHash: Buffer): Promise<IngestTokenRecord | null>;
  markUsed(id: string): Promise<void>;
}
