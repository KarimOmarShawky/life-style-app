/**
 * src/features/ingest/ingest.service.ts
 *
 * Issues and revokes the ingest token for the caller's current login session,
 * and orchestrates the SMS fallback: sanitized candidates go to the analyzer
 * (Gemini behind this backend), and the strict result is returned to the phone.
 */

import { generateIngestToken } from '../../core/security/ingest-token.js';
import { sanitizeSmsText, sanitizeSmsSender } from './sms-sanitizer.js';
import type {
  AnalyzeCandidateInput,
  SmsAnalysisResult,
  SmsTransactionAnalyzer
} from './sms-fallback-analyzer.js';
import type { IngestTokenRepository } from './ingest.repository.js';

export class IngestService {
  constructor(
    private readonly repository: IngestTokenRepository,
    private readonly smsAnalyzer: SmsTransactionAnalyzer
  ) {}

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

  /**
   * Analyzes one likely-transaction candidate. The candidate is sanitized here
   * before the analyzer runs (which sanitizes again), and the returned result
   * follows the strict transaction schema with a fail-safe confidence value.
   */
  async analyzeCandidate(input: AnalyzeCandidateInput): Promise<SmsAnalysisResult> {
    return this.smsAnalyzer.analyze({
      text: sanitizeSmsText(input.text),
      sender: sanitizeSmsSender(input.sender),
      receivedAt: input.receivedAt
    });
  }
}
