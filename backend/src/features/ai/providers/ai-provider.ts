/**
 * src/features/ai/providers/ai-provider.ts
 *
 * Provider-neutral contract for AI text generation (Hybrid AI slice AI-1).
 * The service layer builds one request shape; an adapter per provider
 * translates it. Exactly one provider is configured (AI_PROVIDER) and there
 * is no silent fallback to another provider.
 *
 * Privacy: implementations never log prompts, system instructions or
 * replies; failures carry only a kind.
 */

export const AI_PROVIDER_IDS = ['gemini'] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export interface AiProviderTurn {
  role: 'user' | 'model';
  text: string;
}

export interface AiGenerationSettings {
  temperature: number;
  maxOutputTokens: number;
}

export interface AiProviderInput {
  /** Server-owned instructions, sent apart from any user text. */
  systemInstruction: string;
  /** Conversation turns, oldest first; the last turn is from the user. */
  turns: AiProviderTurn[];
  generation: AiGenerationSettings;
  /**
   * App data for the latest user message (AI-2b): the user's own tasks,
   * habits, goals or events, already framed as data. Untrusted: adapters send
   * it next to that message as data, never inside the system instruction.
   */
  contextData?: string;
  signal?: AbortSignal;
}

export interface AiProvider {
  readonly id: AiProviderId;
  /** Returns the full reply text, or throws AiProviderError. */
  generate(input: AiProviderInput): Promise<{ text: string }>;
  /** Yields reply text chunks as they arrive, or throws AiProviderError. */
  stream(input: AiProviderInput): AsyncIterable<string>;
}

/**
 * `blocked`: the provider's safety filters refused the request or stopped the
 * reply. Clients get the same generic failure as the other kinds; only the
 * kind is logged, so the owner can see how often the filters act.
 */
export type AiProviderErrorKind =
  | 'provider_rate_limited'
  | 'provider_error'
  | 'provider_timeout'
  | 'empty_response'
  | 'invalid_response'
  | 'blocked';

export class AiProviderError extends Error {
  constructor(public readonly kind: AiProviderErrorKind) {
    super(`AI provider failure: ${kind}`);
    this.name = 'AiProviderError';
  }
}
