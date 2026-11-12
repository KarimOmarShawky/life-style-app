/**
 * src/features/ai/providers/gemini.adapter.ts
 *
 * Gemini implementation of the provider-neutral contract. It sends the
 * server prompt through Gemini's system-instruction field, never inside a
 * user turn (AI0-F3), and always sends explicit safety settings (AI0-F5).
 */
import type { GeminiClient, GeminiGenerateInput, GeminiSafetySetting } from '../gemini-client.js';
import type { AiProvider, AiProviderInput } from './ai-provider.js';

/**
 * Server-owned thresholds ("Block some" in AI Studio). Since Gemini 2.5 the
 * API leaves these filters off unless a request sets them. Change them only
 * here, after looking at how often replies end as `blocked` in the logs.
 */
export const GEMINI_SAFETY_SETTINGS: readonly GeminiSafetySetting[] = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
];

export class GeminiAiProvider implements AiProvider {
  public readonly id = 'gemini' as const;

  constructor(private readonly client: GeminiClient) {}

  public async generate(input: AiProviderInput): Promise<{ text: string }> {
    return { text: await this.client.generateText(toGeminiInput(input)) };
  }

  public stream(input: AiProviderInput): AsyncIterable<string> {
    return this.client.streamText(toGeminiInput(input));
  }
}

function toGeminiInput(input: AiProviderInput): GeminiGenerateInput {
  return {
    systemInstruction: input.systemInstruction,
    contents: input.turns.map((turn) => ({ role: turn.role, parts: [{ text: turn.text }] })),
    temperature: input.generation.temperature,
    maxOutputTokens: input.generation.maxOutputTokens,
    safetySettings: GEMINI_SAFETY_SETTINGS,
    ...(input.signal ? { signal: input.signal } : {})
  };
}
