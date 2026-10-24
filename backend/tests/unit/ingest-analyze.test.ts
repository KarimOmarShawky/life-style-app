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
import { IngestController } from '../../src/features/ingest/ingest.controller.js';

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
    if (!seen) throw new Error('Expected sanitized analyzer input');
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

describe('Analyze route result contract for SMS clients (F-01/F-02)', () => {
  /** Minimal express-like doubles: only what analyzeSms touches. */
  function call(status: SmsAnalysisResult['status']) {
    const service = {
      analyzeCandidate: vi.fn(async (): Promise<SmsAnalysisResult> => ({
        status,
        transaction:
          status === 'recognized'
            ? {
                kind: 'expense',
                amount: '250.00',
                currency: 'EGP',
                occurredOn: '2026-10-08',
                description: null,
                merchant: null
              }
            : null,
        confidence: status === 'recognized' ? 'high' : null
      }))
    };
    const controller = new IngestController(service as never);
    const res = {
      setHeader: vi.fn(),
      status: vi.fn(() => res),
      json: vi.fn(() => res)
    };
    const next = vi.fn();
    return { controller, res, next, service };
  }

  it('returns a terminal 200 body for recognized results', async () => {
    const { controller, res, next } = call('recognized');
    await controller.analyzeSms(
      { body: { text: 'paid 250 EGP', receivedAt: '2026-10-08' } } as never,
      res as never,
      next as never
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'recognized', confidence: 'high' })
    );
  });

  it('returns a terminal 200 body for unrecognized results', async () => {
    const { controller, res, next } = call('unrecognized');
    await controller.analyzeSms(
      { body: { text: 'hello', receivedAt: '2026-10-08' } } as never,
      res as never,
      next as never
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      status: 'unrecognized',
      transaction: null,
      confidence: null
    });
  });

  it('reports an unavailable fallback as retryable 503, never as a 200 result', async () => {
    const { controller, res, next } = call('unavailable');
    await controller.analyzeSms(
      { body: { text: 'paid 250 EGP', receivedAt: '2026-10-08' } } as never,
      res as never,
      next as never
    );
    expect(res.status).not.toHaveBeenCalled();
    const error = next.mock.calls[0]?.[0] as { httpStatus: number; code: string };
    expect(error.httpStatus).toBe(503);
    // Same stable code the clients key their retry policy on.
    expect(error.code).toBe('SMS_FALLBACK_UNAVAILABLE');
  });
});
