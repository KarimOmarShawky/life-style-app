/**
 * src/features/ai/ai.types.ts
 *
 * Contract for the server-side AI assistant proxy:
 *   POST /api/v1/ai/chat         -> { reply }
 *   POST /api/v1/ai/chat/stream  -> text/event-stream of { text } events
 *
 * The mobile app no longer holds a Gemini key (BYOK retired). Clients send
 * conversation turns only; the system prompt, model choice, generation
 * parameters and the provider key all stay on the server.
 */

export type AiChatRole = 'user' | 'model';

export interface AiChatTurn {
  role: AiChatRole;
  text: string;
}

/** Generation profiles. Clients pick a profile, never raw parameters. */
export type AiReplyMode = 'chat' | 'brief';

export interface AiChatRequestBody {
  messages: AiChatTurn[];
  /** Display name of the preferred reply language (e.g. "Arabic"). */
  language?: string;
  mode?: AiReplyMode;
}

/** Validated request handed to the service layer. */
export interface AiChatInput {
  messages: AiChatTurn[];
  /** The client's sanitized language name, or null when it sent none. */
  languageHint: string | null;
  mode: AiReplyMode;
}

/** Server-side context for one AI call (never taken from the request body). */
export interface AiCallOptions {
  signal?: AbortSignal;
  /** Account locale, the third choice for the fallback reply language. */
  userLocale?: string;
  /** AI-2 language mode app_locale: always reply in this language (e.g. "German"). */
  fixedReplyLanguage?: string;
  /** AI-2b app context for the latest message, framed as data (see AiProviderInput). */
  contextData?: string;
}

export const AI_LIMITS = {
  maxMessages: 21,
  maxMessageChars: 4000,
  maxTotalChars: 24000,
  maxLanguageChars: 35
} as const;

/** Generation parameters per reply mode (server-owned). */
export const AI_GENERATION: Record<AiReplyMode, { temperature: number; maxOutputTokens: number }> =
  {
    chat: { temperature: 0.7, maxOutputTokens: 800 },
    brief: { temperature: 0.6, maxOutputTokens: 200 }
  };
