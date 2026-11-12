/**
 * src/features/ai-settings/ai-settings.repository.ts
 */
import type { AiSettings, AiSettingsPatch } from './ai-settings.types.js';

export type StoredAiSettings =
  { available: false } | { available: true; settings: AiSettings | null };

export type AiSettingsWriteResult =
  { available: false } | { available: true; settings: AiSettings | null };

export interface AiSettingsRepository {
  /** The account's row, or null when it never saved settings. */
  find(userId: string): Promise<StoredAiSettings>;
  /**
   * Applies only the given fields for an active account, in one statement, so
   * concurrent changes to other fields are kept. `settings` is null when no
   * active account matched.
   */
  update(userId: string, patch: AiSettingsPatch): Promise<AiSettingsWriteResult>;
}
