/**
 * src/features/ai/ai.service.ts
 *
 * Validates AI chat requests and relays them to Gemini with the central
 * server key. Privacy rules for this surface:
 *  - prompts and replies are never logged (only counts and error kinds);
 *  - the provider key never leaves the server;
 *  - the system prompt and generation parameters are server-owned, so a
 *    client can never widen them.
 */

import { AppError } from '../../core/errors/app-error.js';
import { logger } from '../../core/logger/logger.js';
import { AI_GENERATION, AI_LIMITS, type AiChatInput } from './ai.types.js';
import {
  GeminiProviderError,
  type GeminiClient,
  type GeminiGenerateInput
} from './gemini-client.js';

const SYSTEM_PROMPT = `
You are "LifeStyle AI Assistant", an intelligent, empathetic, and highly practical personal productivity coach and life organizer.
You help the user:
- Plan their day and structure their daily schedule with concrete time slots.
- Suggest healthy, sustainable habits and give motivational tips.
- Help them organize their thoughts, notes, and tasks efficiently.
- Answer questions with actionable, clear, bullet-pointed advice.
Language: Always reply in the same language as the user's latest request (Arabic, English, French, or any other language), even when the app interface uses a different language. Keep code, brand names, and numbers as the user wrote them.
Tone: Friendly, motivating, professional, concise, and focused on execution. Avoid fluff.
`.trim();

export class AiService {
  constructor(
    private readonly gemini: GeminiClient | null,
    private readonly enabled: boolean
  ) {}

  /** True only when the kill switch is on AND a central key is configured. */
  public isEnabled(): boolean {
    return this.enabled && this.gemini !== null;
  }

  public async chat(input: AiChatInput, signal?: AbortSignal): Promise<{ reply: string }> {
    const reply = await this.requireClient().generateText(this.buildGenerateInput(input, signal));
    return { reply: reply.trim() };
  }

  public async *chatStream(input: AiChatInput, signal?: AbortSignal): AsyncIterable<string> {
    yield* this.requireClient().streamText(this.buildGenerateInput(input, signal));
  }

  private requireClient(): GeminiClient {
    if (!this.isEnabled() || !this.gemini) {
      throw new AppError({
        httpStatus: 503,
        code: 'AI_DISABLED',
        safeMessage: 'The AI assistant is not available right now.'
      });
    }
    return this.gemini;
  }

  private buildGenerateInput(input: AiChatInput, signal?: AbortSignal): GeminiGenerateInput {
    const generation = AI_GENERATION[input.mode];
    const contents: GeminiGenerateInput['contents'] = input.messages.slice(0, -1).map((turn) => ({
      role: turn.role,
      parts: [{ text: turn.text }]
    }));
    const last = input.messages[input.messages.length - 1]!;
    contents.push({
      role: 'user',
      parts: [
        {
          text:
            `System context: ${SYSTEM_PROMPT}\n` +
            `Reply language: write the reply in the same language as the user request below. ` +
            `Use ${input.languageName} only if the request has no detectable language.\n\n` +
            `User request: ${last.text}`
        }
      ]
    });
    return {
      contents,
      temperature: generation.temperature,
      maxOutputTokens: generation.maxOutputTokens,
      ...(signal ? { signal } : {})
    };
  }
}

/**
 * Maps provider failures to safe client errors. Provider payloads are never
 * forwarded; only the failure kind is logged (no prompt, no reply text).
 */
export function mapAiProviderError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof GeminiProviderError) {
    logger.warn('AI provider request failed', { kind: error.kind });
    if (error.kind === 'provider_rate_limited') {
      return new AppError({
        httpStatus: 503,
        code: 'AI_PROVIDER_ERROR',
        safeMessage: 'The AI assistant is busy right now. Please try again shortly.'
      });
    }
    return new AppError({
      httpStatus: 502,
      code: 'AI_PROVIDER_ERROR',
      safeMessage: 'The AI assistant could not answer right now. Please try again shortly.'
    });
  }
  logger.warn('AI provider request failed', { kind: 'unknown' });
  return new AppError({
    httpStatus: 502,
    code: 'AI_PROVIDER_ERROR',
    safeMessage: 'The AI assistant could not answer right now. Please try again shortly.'
  });
}

/**
 * Validates the raw JSON body of an AI chat request. Rejects anything that
 * exceeds the turn/size budget before any quota or provider work happens.
 */
export function validateAiChatBody(body: unknown): AiChatInput {
  const details: Array<{ field: string; message: string }> = [];
  const fail = (field: string, message: string): void => {
    details.push({ field, message });
  };

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw AppError.validation([{ field: 'body', message: 'A JSON object body is required' }]);
  }
  const record = body as Record<string, unknown>;

  const messages: AiChatInput['messages'] = [];
  const rawMessages = record.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    fail('messages', 'messages must be a non-empty array');
  } else if (rawMessages.length > AI_LIMITS.maxMessages) {
    fail('messages', `messages must contain at most ${AI_LIMITS.maxMessages} turns`);
  } else {
    let totalChars = 0;
    rawMessages.forEach((raw, index) => {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        fail(`messages[${index}]`, 'each message must be an object');
        return;
      }
      const turn = raw as Record<string, unknown>;
      const role = turn.role;
      const text = turn.text;
      if (role !== 'user' && role !== 'model') {
        fail(`messages[${index}].role`, "role must be 'user' or 'model'");
        return;
      }
      if (typeof text !== 'string' || text.trim() === '') {
        fail(`messages[${index}].text`, 'text must be a non-empty string');
        return;
      }
      if (text.length > AI_LIMITS.maxMessageChars) {
        fail(
          `messages[${index}].text`,
          `text must be at most ${AI_LIMITS.maxMessageChars} characters`
        );
        return;
      }
      totalChars += text.length;
      messages.push({ role, text });
    });
    if (details.length === 0 && totalChars > AI_LIMITS.maxTotalChars) {
      fail('messages', `messages must total at most ${AI_LIMITS.maxTotalChars} characters`);
    }
    if (details.length === 0 && messages[messages.length - 1]?.role !== 'user') {
      fail('messages', 'the last message must be from the user');
    }
  }

  let mode: AiChatInput['mode'] = 'chat';
  if (record.mode !== undefined) {
    if (record.mode === 'chat' || record.mode === 'brief') {
      mode = record.mode;
    } else {
      fail('mode', "mode must be 'chat' or 'brief'");
    }
  }

  let languageName = 'Arabic';
  if (record.language !== undefined) {
    if (typeof record.language !== 'string') {
      fail('language', 'language must be a string');
    } else {
      // The language name is interpolated into the prompt: keep only letters
      // and spaces so it can never smuggle instructions or newlines.
      const cleaned = record.language
        .replace(/[^\p{L} ]/gu, '')
        .trim()
        .slice(0, AI_LIMITS.maxLanguageChars);
      if (cleaned !== '') languageName = cleaned;
    }
  }

  if (details.length > 0) {
    throw AppError.validation(details);
  }
  return { messages, languageName, mode };
}
