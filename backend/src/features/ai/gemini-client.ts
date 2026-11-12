/**
 * src/features/ai/gemini-client.ts
 *
 * Thin server-side Gemini transport for the AI proxy. The API key is read
 * from server configuration only, is sent as the `X-goog-api-key` header,
 * and is never logged. Request/response bodies (user prompts, model text)
 * are never logged either; failures surface as typed errors with no
 * provider payload attached.
 */
import { AiProviderError, type AiProviderErrorKind } from './providers/ai-provider.js';

/** Harm categories that generateContent accepts in safetySettings. */
export type GeminiHarmCategory =
  | 'HARM_CATEGORY_HARASSMENT'
  | 'HARM_CATEGORY_HATE_SPEECH'
  | 'HARM_CATEGORY_SEXUALLY_EXPLICIT'
  | 'HARM_CATEGORY_DANGEROUS_CONTENT';

/** Blocking thresholds only: the server never turns a filter off. */
export type GeminiBlockThreshold =
  'BLOCK_LOW_AND_ABOVE' | 'BLOCK_MEDIUM_AND_ABOVE' | 'BLOCK_ONLY_HIGH';

export interface GeminiSafetySetting {
  category: GeminiHarmCategory;
  threshold: GeminiBlockThreshold;
}

export interface GeminiGenerateInput {
  /** Server-owned instructions, sent in Gemini's system-instruction field. */
  systemInstruction?: string;
  contents: Array<{
    role: 'user' | 'model';
    parts: Array<{ text: string }>;
  }>;
  /** Explicit filters; without them Gemini 2.5+ applies none. */
  safetySettings?: readonly GeminiSafetySetting[];
  temperature: number;
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export interface GeminiClient {
  /** Returns the full reply text, or throws GeminiProviderError. */
  generateText(input: GeminiGenerateInput): Promise<string>;
  /** Yields reply text chunks as they arrive. */
  streamText(input: GeminiGenerateInput): AsyncIterable<string>;
}

export type GeminiProviderErrorKind = AiProviderErrorKind;

/** A provider-neutral AiProviderError raised by the Gemini transport. */
export class GeminiProviderError extends AiProviderError {
  constructor(kind: GeminiProviderErrorKind) {
    super(kind);
    this.message = `Gemini provider failure: ${kind}`;
    this.name = 'GeminiProviderError';
  }
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export class FetchGeminiClient implements GeminiClient {
  constructor(
    private readonly options: {
      apiKey: string;
      model: string;
      timeoutMs: number;
      fetchImpl?: FetchLike;
    }
  ) {}

  public async generateText(input: GeminiGenerateInput): Promise<string> {
    const response = await this.call('generateContent', input, false);
    const payload = await this.readJson(response);
    // A reply the filters stopped is never returned, even in part.
    if (isBlocked(payload)) {
      throw new GeminiProviderError('blocked');
    }
    const text = extractText(payload);
    if (text === null) {
      throw new GeminiProviderError('empty_response');
    }
    return text;
  }

  public async *streamText(input: GeminiGenerateInput): AsyncIterable<string> {
    const response = await this.call('streamGenerateContent?alt=sse', input, true);
    if (!response.body) {
      throw new GeminiProviderError('invalid_response');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let sawText = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n');
        while (boundary >= 0) {
          const line = buffer.slice(0, boundary).trim();
          buffer = buffer.slice(boundary + 1);
          boundary = buffer.indexOf('\n');
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '' || data === '[DONE]') continue;
          const event = parseEvent(data);
          // Stop instead of presenting a reply the filters cut off as complete.
          if (isBlocked(event)) {
            throw new GeminiProviderError('blocked');
          }
          const text = extractText(event);
          if (text !== null && text !== '') {
            sawText = true;
            yield text;
          }
        }
      }
    } catch (error) {
      if (error instanceof GeminiProviderError) throw error;
      throw new GeminiProviderError('provider_error');
    } finally {
      reader.releaseLock();
    }
    if (!sawText) {
      throw new GeminiProviderError('empty_response');
    }
  }

  private async call(
    method: string,
    input: GeminiGenerateInput,
    stream: boolean
  ): Promise<Response> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const timeoutSignal = AbortSignal.timeout(this.options.timeoutMs);
    const signal = input.signal ? AbortSignal.any([input.signal, timeoutSignal]) : timeoutSignal;
    let response: Response;
    try {
      response = await fetchImpl(`${GEMINI_BASE_URL}/${this.options.model}:${method}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': this.options.apiKey,
          ...(stream ? { Accept: 'text/event-stream' } : {})
        },
        body: JSON.stringify({
          ...(input.systemInstruction
            ? { systemInstruction: { parts: [{ text: input.systemInstruction }] } }
            : {}),
          generationConfig: {
            temperature: input.temperature,
            maxOutputTokens: input.maxOutputTokens
          },
          ...(input.safetySettings && input.safetySettings.length > 0
            ? { safetySettings: input.safetySettings }
            : {}),
          contents: input.contents
        }),
        signal
      });
    } catch {
      // Distinguish our own deadline from other transport failures without
      // leaking provider or network details.
      throw new GeminiProviderError(timeoutSignal.aborted ? 'provider_timeout' : 'provider_error');
    }
    if (response.status === 429) {
      throw new GeminiProviderError('provider_rate_limited');
    }
    if (!response.ok) {
      throw new GeminiProviderError('provider_error');
    }
    return response;
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new GeminiProviderError('invalid_response');
    }
  }
}

function parseEvent(data: string): unknown {
  try {
    return JSON.parse(data) as unknown;
  } catch {
    throw new GeminiProviderError('invalid_response');
  }
}

const BLOCKING_FINISH_REASONS = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII']);

/**
 * True when Gemini refused the prompt (promptFeedback.blockReason) or stopped
 * the first candidate for a safety reason (finishReason).
 */
export function isBlocked(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false;
  const feedback = (payload as { promptFeedback?: unknown }).promptFeedback as
    { blockReason?: unknown } | undefined;
  const blockReason = feedback?.blockReason;
  if (
    typeof blockReason === 'string' &&
    blockReason !== '' &&
    blockReason !== 'BLOCK_REASON_UNSPECIFIED'
  ) {
    return true;
  }
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return false;
  const finishReason = (candidates[0] as { finishReason?: unknown } | null)?.finishReason;
  return typeof finishReason === 'string' && BLOCKING_FINISH_REASONS.has(finishReason);
}

/** Extracts the concatenated text parts of the first candidate, if any. */
export function extractText(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const first = candidates[0] as { content?: unknown };
  const content = first?.content as { parts?: unknown } | undefined;
  const parts = content?.parts;
  if (!Array.isArray(parts)) return null;
  const texts: string[] = [];
  for (const part of parts) {
    const text = (part as { text?: unknown })?.text;
    if (typeof text === 'string' && text !== '') texts.push(text);
  }
  if (texts.length === 0) return null;
  const joined = texts.join('');
  return joined.trim() === '' ? null : joined;
}
