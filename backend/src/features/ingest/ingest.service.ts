/**
 * src/features/ingest/ingest.service.ts
 *
 * Issues and revokes the ingest token for the caller's current login session.
 */

import { generateIngestToken } from '../../core/security/ingest-token.js';
import type { IngestTokenRepository } from './ingest.repository.js';

export class IngestService {
  constructor(private readonly repository: IngestTokenRepository) {}

  /** Returns the raw token once. Only its digest is stored. */
  async issueForSession(userId: string, sessionId: string): Promise<string> {
    const generated = generateIngestToken();
    await this.repository.replaceForSession({
      userId,
      sessionId,
      tokenHash: generated.tokenHash
    });
    return generated.token;
  }

  async revokeForSession(sessionId: string): Promise<void> {
    await this.repository.revokeForSession(sessionId);
  }
}
