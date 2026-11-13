/**
 * src/features/ai-settings/ai-settings.types.ts
 *
 * Hybrid AI slice AI-2: per-account AI settings and the durable, versioned
 * consent to send AI requests to the provider (decision D5).
 *
 *   GET   /api/v1/ai/settings
 *   PATCH /api/v1/ai/settings
 *
 * One row per account at most (ai_user_settings); no row means the defaults
 * below. The memory, learning and quick-action switches are stored now so the
 * later slices (AI-3 to AI-5) need no further owner SQL; nothing reads them
 * yet.
 */

/**
 * The consent text the app shows is version 1. Raise this when that text
 * changes materially: every account then has to agree again before any
 * personal context is sent (AI-2b).
 */
export const AI_EGRESS_CONSENT_VERSION = 1;

export const AI_LANGUAGE_MODES = ['auto', 'app_locale'] as const;
export type AiLanguageMode = (typeof AI_LANGUAGE_MODES)[number];

export interface AiSettings {
  /** The consent version the account agreed to, or null (never or withdrawn). */
  egressConsentVersion: number | null;
  /** ISO time of that agreement, or null. */
  egressConsentAt: string | null;
  memoryEnabled: boolean;
  explicitMemoryEnabled: boolean;
  learningEnabled: boolean;
  quickActionsEnabled: boolean;
  /** 'auto': answer in the language of the message; 'app_locale': the account language. */
  languageMode: AiLanguageMode;
}

export const DEFAULT_AI_SETTINGS: Readonly<AiSettings> = Object.freeze({
  egressConsentVersion: null,
  egressConsentAt: null,
  memoryEnabled: false,
  explicitMemoryEnabled: false,
  learningEnabled: false,
  quickActionsEnabled: false,
  languageMode: 'auto'
});

/** A validated PATCH body: only the fields the client sent. */
export interface AiSettingsPatch {
  /** A number grants the current version; null withdraws the consent. */
  egressConsentVersion?: number | null | undefined;
  memoryEnabled?: boolean | undefined;
  explicitMemoryEnabled?: boolean | undefined;
  learningEnabled?: boolean | undefined;
  quickActionsEnabled?: boolean | undefined;
  languageMode?: AiLanguageMode | undefined;
}

export interface AiSettingsView {
  settings: AiSettings;
  currentConsentVersion: number;
  /** False until the owner-run SQL has created the table; the defaults are shown. */
  available: boolean;
}
