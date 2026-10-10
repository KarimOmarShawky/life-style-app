/**
 * tests/unit/ingest-analyze.test.ts
 *
 * The ingest service and request schema for the SMS fallback analyze route.
 * The service sanitizes before delegating to the analyzer (which sanitizes
 * again), and the request body is strictly validated.
 */

import { describe, it, expect, vi } from 'vitest';
import { IngestService } from '../../src/features/ingest/ingest.service.js';
import { analyzeSmsRequestSchema } from '../../src/features/ingest/ingest.validation.js';
import type {
  SmsAnalysisResult,
  SmsTransactionAnalyzer
} from '../../src/features/ingest/sms-fallback-analyzer.js';
import type { IngestTokenRepository } from '../../src/features/ingest/ingest.repository.js';

const unusedIngestRepository: IngestTokenRepository = {
  replaceForSession: vi.fn(),
  revokeForSession: vi.fn(),
  findActiveByHash: vi.fn(),
  markUsed: vi.fn()
};

function recordingAnalyzer(): {
  analyzer: SmsTransactionAnalyzer;
  calls: Array<{ text: string; sender: string; receivedAt: string }>;
} {
  const calls: Array<{ text: string; sender: string; receivedAt: string }> = [];
  return {
    calls,
    analyzer: {
      analyze: vi.fn(async (input) => {
        calls.push({
          text: input.text,
          sender: input.sender ?? '',
          receivedAt: input.receivedAt
        });
        const result: SmsAnalysisResult = {
          status: 'recognized',
          confidence: 'low',
          transaction: {
            kind: 'expense',
            amount: '250.00',
            currency: 'EGP',
            occurredOn: '2026-10-08',
            description: null,
            merchant: null
          }
        };
        return result;
      })
    }
  };
}

describe('IngestService.analyzeCandidate', () => {
  it('sanitizes text and sender before the analyzer ever sees them', async () => {
    const { analyzer, calls } = recordingAnalyzer();
    const service = new IngestService(unusedIngestRepository, analyzer);

    await service.analyzeCandidate({
      text: 'Your OTP is 918273. Paid 250 EGP to +20 100 000 0000 on 08/10/2026. Balance 9,900.00 EGP.',
      sender: '+201000000000',
      receivedAt: '2026-10-08'
    });

    expect(calls).toHaveLength(1);
    const seen = calls[0];
    expect(seen.text).not.toContain('918273');
    expect(seen.text).not.toContain('100 000 0000');
    expect(seen.text).not.toContain('08/10/2026');
    expect(seen.text).not.toContain('9,900.00');
    expect(seen.text).toContain('[OTP]');
    expect(seen.text).toContain('[PHONE]');
    expect(seen.text).toContain('[DATE]');
    expect(seen.text).toContain('[BALANCE]');
    expect(seen.text).toContain('250 EGP');
    expect(seen.sender).toBe('[PHONE]');
    expect(seen.receivedAt).toBe('2026-10-08');
  });

  it('returns the analyzer result untouched so confidence rules stay in one place', async () => {
    const { analyzer } = recordingAnalyzer();
    const service = new IngestService(unusedIngestRepository, analyzer);
    const result = await service.analyzeCandidate({
      text: 'paid 250',
      receivedAt: '2026-10-08'
    });
    expect(result.status).toBe('recognized');
    expect(result.confidence).toBe('low');
  });
});

describe('analyzeSmsRequestSchema', () => {
  it('accepts a valid candidate body', () => {
    const parsed = analyzeSmsRequestSchema.parse({
      text: 'paid 250 EGP',
      sender: 'NBE',
      receivedAt: '2026-10-08T13:05:00Z'
    });
    expect(parsed.text).toBe('paid 250 EGP');
    expect(parsed.receivedAt).toBe('2026-10-08T13:05:00Z');
  });

  it('accepts a plain date for receivedAt and drops a missing sender', () => {
    const parsed = analyzeSmsRequestSchema.parse({
      text: 'paid 250 EGP',
      receivedAt: '2026-10-08'
    });
    expect(parsed.sender).toBeUndefined();
  });

  it('rejects missing, empty, oversized or malformed fields', () => {
    const cases: Array<Record<string, unknown>> = [
      { receivedAt: '2026-10-08' },
      { text: '', receivedAt: '2026-10-08' },
      { text: 'x'.repeat(2001), receivedAt: '2026-10-08' },
      { text: 'paid 250', receivedAt: '08/10/2026' },
      { text: 'paid 250', receivedAt: 'not-a-date' },
      { text: 'paid 250', receivedAt: '2026-10-08', sender: 'x'.repeat(121) },
      { text: 123, receivedAt: '2026-10-08' }
    ];
    for (const body of cases) {
      expect(() => analyzeSmsRequestSchema.parse(body), JSON.stringify(body)).toThrow();
    }
  });
});
