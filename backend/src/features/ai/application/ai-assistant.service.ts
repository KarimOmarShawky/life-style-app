/**
 * src/features/ai/application/ai-assistant.service.ts
 *
 * Hybrid AI slice AI-2b: one assistant turn with optional server-side
 * context.
 *
 *  - Context scopes need the account's durable consent to the current
 *    consent version (AI-2 settings); otherwise the turn is denied with
 *    `consent_required` before anything is read or sent. Without the
 *    settings table the answer is `scope_unavailable`.
 *  - A turn without scopes works like the plain chat proxy.
 *  - Saved memories (AI-3) are added only when the account has memory on
 *    and the durable consent is current; otherwise the turn simply goes
 *    without them. Reading them never fails the turn.
 *  - Language mode `app_locale` fixes the reply language to the app language.
 *  - A reply the provider's safety filters stop becomes
 *    `unsupported_or_denied` / `unsupported`, never text.
 *
 * Nothing here logs the message, the conversation, the context or the reply.
 */
import type { AuthenticatedUserContext } from '../../../core/security/session-validator.js';
import { logger } from '../../../core/logger/logger.js';
import type { AiMemoriesService } from '../../ai-memories/ai-memories.service.js';
import type { AiSettingsService } from '../../ai-settings/ai-settings.service.js';
import type { AiSettingsView } from '../../ai-settings/ai-settings.types.js';
import { mapAiProviderError, type AiService } from '../ai.service.js';
import type { AiCallOptions, AiChatInput, AiChatTurn } from '../ai.types.js';
import { AiProviderError } from '../providers/ai-provider.js';
import {
  renderContextForModel,
  renderMemoriesForModel,
  type AiContextBuilder,
  type AiContextScope
} from './ai-context-builder.js';
import { isClearlyArabicScript, languageForLocale, localeBase } from './ai-language-resolver.js';

export type AiAssistantDenialReason = 'consent_required' | 'scope_unavailable' | 'unsupported';

export interface AiAssistantDenial {
  type: 'unsupported_or_denied';
  reason: AiAssistantDenialReason;
}

export interface AiAssistantAnswer {
  type: 'answer';
  text: string;
  /** BCP-47 base of the reply language when known ("ar"), else null. */
  language: string | null;
}

export type AiAssistantTurnResult = AiAssistantAnswer | AiAssistantDenial;

export interface AiAssistantTurnInput {
  message: string;
  conversation?: AiChatTurn[] | undefined;
  contextScopes?: AiContextScope[] | undefined;
  clientLocale?: string | undefined;
}

export interface PreparedAssistantTurn {
  input: AiChatInput;
  options: AiCallOptions;
  /** Set in language mode app_locale: the language every reply must use. */
  fixedLanguageCode: string | null;
}

export const unsupportedDenial: AiAssistantDenial = {
  type: 'unsupported_or_denied',
  reason: 'unsupported'
};

/** The reply language when it is known: fixed by the settings, or Arabic script. */
export function replyLanguage(text: string, fixedLanguageCode: string | null): string | null {
  if (fixedLanguageCode) return fixedLanguageCode;
  return isClearlyArabicScript(text) ? 'ar' : null;
}

export function isSafetyBlock(error: unknown): boolean {
  return error instanceof AiProviderError && error.kind === 'blocked';
}

export class AiAssistantService {
  constructor(
    private readonly ai: Pick<AiService, 'chat' | 'chatStream'>,
    private readonly settings: Pick<AiSettingsService, 'get'>,
    private readonly context: Pick<AiContextBuilder, 'build'>,
    private readonly memories?: Pick<AiMemoriesService, 'forContext'>
  ) {}

  /** Checks the consent and builds the provider request, or returns the denial. */
  public async prepare(
    user: AuthenticatedUserContext,
    body: AiAssistantTurnInput,
    signal?: AbortSignal
  ): Promise<{ denied: AiAssistantDenial } | { prepared: PreparedAssistantTurn }> {
    const scopes = body.contextScopes ?? [];
    const view = await this.readSettings(user.id);
    if (scopes.length > 0) {
      if (!view?.available) {
        return { denied: { type: 'unsupported_or_denied', reason: 'scope_unavailable' } };
      }
      if (view.settings.egressConsentVersion !== view.currentConsentVersion) {
        return { denied: { type: 'unsupported_or_denied', reason: 'consent_required' } };
      }
    }

    const parts: string[] = [];
    if (scopes.length > 0) {
      parts.push(renderContextForModel(await this.context.build(user, scopes)));
    }
    const consented =
      view?.available === true && view.settings.egressConsentVersion === view.currentConsentVersion;
    if (consented && view.settings.memoryEnabled && this.memories) {
      const saved = await this.memories.forContext(user.id);
      if (saved.length > 0) parts.push(renderMemoriesForModel(saved));
    }
    const contextData = parts.length > 0 ? parts.join('\n\n') : undefined;
    const appLocale = body.clientLocale ?? user.locale;
    const fixed = view?.settings.languageMode === 'app_locale';
    const input: AiChatInput = {
      messages: [...(body.conversation ?? []), { role: 'user', text: body.message }],
      languageHint: body.clientLocale ? languageForLocale(body.clientLocale) : null,
      mode: 'chat'
    };
    const options: AiCallOptions = {
      userLocale: user.locale,
      ...(fixed ? { fixedReplyLanguage: languageForLocale(appLocale) } : {}),
      ...(contextData !== undefined ? { contextData } : {}),
      ...(signal ? { signal } : {})
    };
    return {
      prepared: { input, options, fixedLanguageCode: fixed ? localeBase(appLocale) : null }
    };
  }

  public async turn(
    user: AuthenticatedUserContext,
    body: AiAssistantTurnInput
  ): Promise<AiAssistantTurnResult> {
    const outcome = await this.prepare(user, body);
    if ('denied' in outcome) return outcome.denied;
    const { input, options, fixedLanguageCode } = outcome.prepared;
    try {
      const { reply } = await this.ai.chat(input, options);
      return { type: 'answer', text: reply, language: replyLanguage(reply, fixedLanguageCode) };
    } catch (error) {
      if (isSafetyBlock(error)) {
        mapAiProviderError(error); // logs the kind only
        return unsupportedDenial;
      }
      throw error;
    }
  }

  public stream(prepared: PreparedAssistantTurn): AsyncIterable<string> {
    return this.ai.chatStream(prepared.input, prepared.options);
  }

  private async readSettings(userId: string): Promise<AiSettingsView | null> {
    try {
      return await this.settings.get(userId);
    } catch {
      // A turn without context must not fail because the settings could not
      // be read; with context it is denied as scope_unavailable.
      logger.warn('AI settings could not be read for an assistant turn');
      return null;
    }
  }
}
