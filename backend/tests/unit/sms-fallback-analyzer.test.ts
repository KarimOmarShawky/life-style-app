/**
 * tests/unit/sms-fallback-analyzer.test.ts
 *
 * The backend-only Gemini fallback: it must never see raw SMS (only sanitized
 * text), must never leak the API key, must enforce the strict transaction
 * schema, and must fail safe on confidence (only clean parses may auto-save).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  GeminiSmsFallbackAnalyzer,
  SmsFallbackUnavailableError
} from '../../src/features/ingest/sms-fallback-analyzer.js';

function geminiResponse(text: string | object, status = 200): Response {
  const body =
    typeof text === 'string'
      ? { candidates: [{ content: { parts: [{ text }] } }] }
      : { candidates: [{ content: { parts: [{ text: JSON.stringify(text) }] } }] };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function analyzerWith(
  fetchImpl: typeof fetch,
  apiKey = 'test-sms-fallback-key'
): GeminiSmsFallbackAnalyzer {
  return new GeminiSmsFallbackAnalyzer({
    apiKey,
    model: 'gemini-3.5-flash-lite',
    timeoutMs: 1000,
    fetchImpl
  });
}

const VALID_MODEL_OUTPUT = {
  isTransaction: true,
  kind: 'expense',
  amount: '250.00',
  currency: 'EGP',
  merchant: 'InstaPay',
  description: 'Transfer via wallet',
  confidence: 'high'
};

describe('GeminiSmsFallbackAnalyzer', () => {
  it('is disabled without a key and never calls the network', async () => {
    const fetchImpl = vi.fn();
    const analyzer = new GeminiSmsFallbackAnalyzer({
      apiKey: undefined,
      model: 'gemini-3.5-flash-lite',
      timeoutMs: 1000,
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    expect(analyzer.enabled).toBe(false);
    const result = await analyzer.analyze({
      text: 'تم تحويل 250 جنيه',
      receivedAt: '2026-10-08'
    });
    expect(result).toEqual({ status: 'unavailable', transaction: null, confidence: null });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns a strict transaction for a clean high-confidence parse', async () => {
    const fetchImpl = vi.fn(async () => geminiResponse(VALID_MODEL_OUTPUT));
    const result = await analyzerWith(fetchImpl as unknown as typeof fetch).analyze({
      text: 'تم تحويل مبلغ 250.00 جنيه عبر انستاباي',
      sender: 'IPN',
      receivedAt: '2026-10-08T13:05:00Z'
    });

    expect(result.status).toBe('recognized');
    expect(result.confidence).toBe('high');
    expect(result.transaction).toEqual({
      kind: 'expense',
      amount: '250.00',
      currency: 'EGP',
      occurredOn: '2026-10-08',
      description: 'Transfer via wallet',
      merchant: 'InstaPay'
    });
  });

  it('keeps low confidence when the model is unsure, and demotes when a merchant is missing', async () => {
    const low = await analyzerWith(
      vi.fn(async () =>
        geminiResponse({ ...VALID_MODEL_OUTPUT, confidence: 'low' })
      ) as unknown as typeof fetch
    ).analyze({ text: 'money moved maybe 250', receivedAt: '2026-10-08' });
    expect(low.confidence).toBe('low');

    const demoted = await analyzerWith(
      vi.fn(async () =>
        geminiResponse({ ...VALID_MODEL_OUTPUT, merchant: '', confidence: 'high' })
      ) as unknown as typeof fetch
    ).analyze({ text: 'money moved 250', receivedAt: '2026-10-08' });
    expect(demoted.confidence).toBe('low');
  });

  it('treats non-transactions as unrecognized', async () => {
    const result = await analyzerWith(
      vi.fn(async () =>
        geminiResponse({ ...VALID_MODEL_OUTPUT, isTransaction: false })
      ) as unknown as typeof fetch
    ).analyze({ text: 'Your OTP is 123456', receivedAt: '2026-10-08' });
    expect(result.status).toBe('unrecognized');
    expect(result.transaction).toBeNull();
  });

  it('enforces the strict schema and rejects incomplete or malformed parses', async () => {
    const cases: object[] = [
      { ...VALID_MODEL_OUTPUT, amount: '250.999' }, // scale too large
      { ...VALID_MODEL_OUTPUT, amount: '-5' },
      { ...VALID_MODEL_OUTPUT, amount: 'abc' },
      { ...VALID_MODEL_OUTPUT, amount: null },
      { ...VALID_MODEL_OUTPUT, kind: 'transfer' },
      { ...VALID_MODEL_OUTPUT, currency: 'EGP pounds' },
      { ...VALID_MODEL_OUTPUT, isTransaction: 'yes' }
    ];
    for (const modelOutput of cases) {
      const result = await analyzerWith(
        vi.fn(async () => geminiResponse(modelOutput)) as unknown as typeof fetch
      ).analyze({ text: 'paid something 250', receivedAt: '2026-10-08' });
      expect(result.status, JSON.stringify(modelOutput)).toBe('unrecognized');
      expect(result.transaction).toBeNull();
    }

    // Not JSON at all: the model ignored the instruction.
    const notJson = await analyzerWith(
      vi.fn(async () => geminiResponse('I think this is a payment!')) as unknown as typeof fetch
    ).analyze({ text: 'paid 250', receivedAt: '2026-10-08' });
    expect(notJson.status).toBe('unrecognized');
  });

  it('normalizes numeric amounts and defaults the currency to EGP', async () => {
    const result = await analyzerWith(
      vi.fn(async () =>
        geminiResponse({ ...VALID_MODEL_OUTPUT, amount: 250, currency: '' })
      ) as unknown as typeof fetch
    ).analyze({ text: 'paid 250', receivedAt: '2026-10-08' });
    expect(result.transaction?.amount).toBe('250.00');
    expect(result.transaction?.currency).toBe('EGP');
  });

  it('re-sanitizes model description and merchant before returning them', async () => {
    const fetchImpl = vi.fn(async () =>
      geminiResponse({
        ...VALID_MODEL_OUTPUT,
        description:
          'Transfer to +20 100 000 0000 ref 99887766 on 08/10/2026 via https://pay.example.com',
        merchant: 'Vodafone [PHONE] 01000000000'
      })
    );
    const result = await analyzerWith(fetchImpl as unknown as typeof fetch).analyze({
      text: 'transfer 250',
      receivedAt: '2026-10-08'
    });

    const description = result.transaction?.description ?? '';
    expect(description).not.toContain('100 000 0000');
    expect(description).not.toContain('99887766');
    expect(description).not.toContain('08/10/2026');
    expect(description).not.toContain('https://pay.example.com');
    const merchant = result.transaction?.merchant ?? '';
    expect(merchant).not.toContain('01000000000');
  });

  it('sends only sanitized text to the model and never the raw body', async () => {
    let requestBody = '';
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      requestBody = String(init?.body ?? '');
      return geminiResponse(VALID_MODEL_OUTPUT);
    });
    await analyzerWith(fetchImpl as unknown as typeof fetch).analyze({
      text: 'Your OTP is 918273. Call 01000000000. Balance 12,900.10 EGP. Paid 250 EGP. Ref 552311988',
      sender: '+201000000000',
      receivedAt: '2026-10-08'
    });

    expect(requestBody).not.toContain('918273');
    expect(requestBody).not.toContain('01000000000');
    expect(requestBody).not.toContain('12,900.10');
    expect(requestBody).not.toContain('552311988');
    expect(requestBody).not.toContain('+201000000000');
    expect(requestBody).toContain('[OTP]');
    expect(requestBody).toContain('[PHONE]');
    expect(requestBody).toContain('[BALANCE]');
    expect(requestBody).toContain('250 EGP');
  });

  it('throws a retryable error without leaking the key when the API fails', async () => {
    const fetchImpl = vi.fn(async () => new Response('secret-key-echo', { status: 500 }));
    const analyzer = analyzerWith(fetchImpl as unknown as typeof fetch, 'super-secret-key');
    await expect(
      analyzer.analyze({ text: 'paid 250', receivedAt: '2026-10-08' })
    ).rejects.toBeInstanceOf(SmsFallbackUnavailableError);

    try {
      await analyzer.analyze({ text: 'paid 250', receivedAt: '2026-10-08' });
    } catch (err) {
      expect(String(err)).not.toContain('super-secret-key');
      expect(String(err)).not.toContain('secret-key-echo');
      expect(String(err)).not.toContain('paid 250');
    }
  });

  it('throws a retryable error on network failure and timeout', async () => {
    const networkFail = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(
      analyzerWith(networkFail as unknown as typeof fetch).analyze({
        text: 'paid 250',
        receivedAt: '2026-10-08'
      })
    ).rejects.toBeInstanceOf(SmsFallbackUnavailableError);

    const hang = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    await expect(
      analyzerWith(hang as unknown as typeof fetch).analyze({
        text: 'paid 250',
        receivedAt: '2026-10-08'
      })
    ).rejects.toBeInstanceOf(SmsFallbackUnavailableError);
  });

  it('rejects invalid metadata dates instead of guessing', async () => {
    const fetchImpl = vi.fn(async () => geminiResponse(VALID_MODEL_OUTPUT));
    const result = await analyzerWith(fetchImpl as unknown as typeof fetch).analyze({
      text: 'paid 250',
      receivedAt: 'not-a-date'
    });
    expect(result.status).toBe('unrecognized');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses the message date as occurredOn and never takes dates from the model', async () => {
    const result = await analyzerWith(
      vi.fn(async () =>
        geminiResponse({ ...VALID_MODEL_OUTPUT, occurredOn: '2001-01-01' })
      ) as unknown as typeof fetch
    ).analyze({ text: 'paid 250', receivedAt: '2026-10-08T23:59:00Z' });
    expect(result.transaction?.occurredOn).toBe('2026-10-08');
  });
});
