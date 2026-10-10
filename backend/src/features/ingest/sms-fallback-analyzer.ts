/**
 * src/features/ingest/sms-fallback-analyzer.ts
 *
 * Backend-only Gemini fallback for SMS auto-capture. When the local, on-device
 * parser sees a likely transaction it cannot recognize, the phone queues a
 * candidate and this analyzer is the only component allowed to consult Gemini.
 *
 * Hard rules:
 * - The model only ever sees text that has been sanitized (and the analyzer
 *   sanitizes again on its way in: "re-sanitize"). Raw SMS never leaves the phone
 *   and is never written to logs, including in error messages.
 * - The Gemini key lives in server configuration (SMS_FALLBACK_GEMINI_KEY). It is
 *   never part of any client build or API response.
 * - Model output must match the strict transaction schema. Anything else is
 *   treated as unrecognized and dropped.
 * - Confidence defaults to "low". Only a clean, complete parse may be "high".
 *   High confidence may auto-save; low confidence requires user confirmation.
 */

import { z } from 'zod';
import {
  sanitizeSmsText,
  sanitizeSmsSender,
  sanitizeModelDescription,
  sanitizeModelMerchant
} from './sms-sanitizer.js';

export type SmsAnalysisConfidence = 'high' | 'low';

export type SmsAnalysisStatus = 'recognized' | 'unrecognized' | 'unavailable';

export interface AnalyzeCandidateInput {
  /** SMS body as received on the phone. Sanitized again before it is used. */
  text: string;
  /** Sender id as received on the phone. Sanitized again before it is used. */
  sender?: string | undefined;
  /** When the SMS arrived (client clock), used as occurredOn. */
  receivedAt: string;
}

export interface AnalyzedTransaction {
  kind: 'expense' | 'income';
  amount: string;
  currency: string;
  occurredOn: string;
  description: string | null;
  merchant: string | null;
}

export interface SmsAnalysisResult {
  status: SmsAnalysisStatus;
  transaction: AnalyzedTransaction | null;
  confidence: SmsAnalysisConfidence | null;
}

export interface SmsTransactionAnalyzer {
  analyze(input: AnalyzeCandidateInput): Promise<SmsAnalysisResult>;
}

/** Thrown when the fallback cannot run (missing key, network, upstream error). */
export class SmsFallbackUnavailableError extends Error {
  constructor(message = 'SMS fallback is temporarily unavailable') {
    super(message);
    this.name = 'SmsFallbackUnavailableError';
  }
}

const MODEL_OUTPUT_SCHEMA = z.object({
  isTransaction: z.boolean(),
  kind: z.enum(['expense', 'income']).optional().nullable(),
  amount: z.union([z.string(), z.number()]).optional().nullable(),
  currency: z.union([z.string(), z.number()]).optional().nullable(),
  merchant: z.union([z.string(), z.null()]).optional(),
  description: z.union([z.string(), z.null()]).optional(),
  confidence: z.enum(['high', 'low']).optional().nullable()
});

const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const PROMPT_HEADER = `You extract wallet or bank transaction data from one sanitized SMS message.
The text contains redaction placeholders such as [OTP], [PHONE], [ACCOUNT], [REFERENCE], [URL], [EMAIL], [BALANCE], [FEE], [DATE], [PERCENT] and [PROMO]. Placeholders never hold transaction data.
Decide whether the message describes exactly one money movement (payment, transfer, withdrawal, deposit, purchase, cash-in or cash-out).
Return a single JSON object with exactly these fields:
{
  "isTransaction": boolean,
  "kind": "expense" or "income",
  "amount": decimal string with at most 2 decimals, digits only,
  "currency": ISO-4217 code such as EGP,
  "merchant": short merchant, wallet or bank name if present, otherwise empty string,
  "description": short neutral description of the movement,
  "confidence": "high" when amount, direction and merchant are unambiguous, otherwise "low"
}
Rules:
- isTransaction is false for OTP codes, balance or fee information, promotions, and alerts without a money movement.
- amount is the transaction amount only, never a balance, fee, reference number or percentage.
- kind is "income" for received/deposited/credited money and "expense" for everything else.
- Do not invent data. When any field is inferred or ambiguous, use confidence "low".`;

export interface GeminiSmsFallbackAnalyzerOptions {
  apiKey?: string | undefined;
  model: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  endpointBase?: string;
}

export class GeminiSmsFallbackAnalyzer implements SmsTransactionAnalyzer {
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly endpointBase: string;

  constructor(options: GeminiSmsFallbackAnalyzerOptions) {
    this.apiKey = options.apiKey?.trim() || undefined;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.endpointBase = options.endpointBase ?? 'https://generativelanguage.googleapis.com/v1beta';
  }

  /** False when no key is configured: the fallback is off and nothing is sent. */
  get enabled(): boolean {
    return this.apiKey !== undefined;
  }

  async analyze(input: AnalyzeCandidateInput): Promise<SmsAnalysisResult> {
    if (!this.enabled) {
      return { status: 'unavailable', transaction: null, confidence: null };
    }

    // Defense in depth: sanitize again even if the caller claims the text is clean.
    const safeText = sanitizeSmsText(input.text);
    const safeSender = sanitizeSmsSender(input.sender);
    const occurredOn = DATE_PATTERN.test(input.receivedAt)
      ? input.receivedAt
      : input.receivedAt.slice(0, 10);
    if (!DATE_PATTERN.test(occurredOn)) {
      // Invalid metadata cannot be trusted; fail safe instead of guessing a date.
      return { status: 'unrecognized', transaction: null, confidence: null };
    }
    if (safeText.length === 0) {
      return { status: 'unrecognized', transaction: null, confidence: null };
    }

    const modelText = await this.callModel(safeText, safeSender, occurredOn);
    return this.parseModelText(modelText, occurredOn);
  }

  private async callModel(
    safeText: string,
    safeSender: string,
    occurredOn: string
  ): Promise<string> {
    const url = `${this.endpointBase}/models/${this.model}:generateContent`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey as string
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `${PROMPT_HEADER}\n\nSender: ${safeSender}\nMessage date: ${occurredOn}\n\nMessage:\n${safeText}`
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'object',
              properties: {
                isTransaction: { type: 'boolean' },
                kind: { type: 'string', enum: ['expense', 'income'] },
                amount: { type: 'string' },
                currency: { type: 'string' },
                merchant: { type: 'string' },
                description: { type: 'string' },
                confidence: { type: 'string', enum: ['high', 'low'] }
              },
              required: ['isTransaction', 'kind', 'amount', 'currency', 'confidence'],
              propertyOrdering: [
                'isTransaction',
                'kind',
                'amount',
                'currency',
                'merchant',
                'description',
                'confidence'
              ]
            }
          }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        // Never include upstream bodies in errors: they can echo request content.
        throw new SmsFallbackUnavailableError(`Gemini responded with status ${response.status}`);
      }

      const payload = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
      };
      const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== 'string' || text.length === 0) {
        throw new SmsFallbackUnavailableError('Gemini returned an empty response');
      }
      return text;
    } catch (err) {
      if (err instanceof SmsFallbackUnavailableError) {
        throw err;
      }
      // Aborts, DNS failures, and malformed upstream JSON are all retryable later.
      throw new SmsFallbackUnavailableError('Gemini request failed');
    } finally {
      clearTimeout(timer);
    }
  }

  private parseModelText(modelText: string, occurredOn: string): SmsAnalysisResult {
    let rawJson: unknown;
    try {
      rawJson = JSON.parse(modelText);
    } catch {
      // The model ignored the JSON instruction: nothing can be trusted.
      return { status: 'unrecognized', transaction: null, confidence: null };
    }

    const parsed = MODEL_OUTPUT_SCHEMA.safeParse(rawJson);
    if (!parsed.success || !parsed.data.isTransaction) {
      return { status: 'unrecognized', transaction: null, confidence: null };
    }

    const data = parsed.data;
    const amount = normalizeAmount(data.amount);
    const currency = normalizeCurrency(data.currency);
    if (
      amount === null ||
      currency === null ||
      (data.kind !== 'expense' && data.kind !== 'income')
    ) {
      // Strict schema: an incomplete parse is not a transaction.
      return { status: 'unrecognized', transaction: null, confidence: null };
    }

    const description = sanitizeModelDescription(data.description);
    const merchant = sanitizeModelMerchant(data.merchant);

    // Fail safe: only a complete, explicit parse may be "high".
    const confidence: SmsAnalysisConfidence =
      data.confidence === 'high' && merchant !== null ? 'high' : 'low';

    return {
      status: 'recognized',
      confidence,
      transaction: {
        kind: data.kind,
        amount,
        currency,
        occurredOn,
        description,
        merchant
      }
    };
  }
}

function normalizeAmount(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  // JSON numbers are accepted and normalized to the strict decimal string form.
  const text = typeof raw === 'number' ? raw.toFixed(2) : raw.trim();
  if (!AMOUNT_PATTERN.test(text)) {
    return null;
  }
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return text;
}

function normalizeCurrency(raw: string | number | null | undefined): string | null {
  // The mobile app defaults wallet SMS to EGP; keep the same default here.
  if (raw === null || raw === undefined || raw === '') {
    return 'EGP';
  }
  const text = String(raw).trim().toUpperCase();
  return CURRENCY_PATTERN.test(text) ? text : null;
}
