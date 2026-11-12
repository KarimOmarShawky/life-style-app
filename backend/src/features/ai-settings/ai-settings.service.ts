/**
 * src/features/ai-settings/ai-settings.service.ts
 */
import { AppError } from '../../core/errors/app-error.js';
import type { AiSettingsRepository } from './ai-settings.repository.js';
import {
  AI_EGRESS_CONSENT_VERSION,
  DEFAULT_AI_SETTINGS,
  type AiSettings,
  type AiSettingsPatch,
  type AiSettingsView
} from './ai-settings.types.js';

export class AiSettingsService {
  constructor(
    private readonly repo: AiSettingsRepository,
    private readonly currentConsentVersion: number = AI_EGRESS_CONSENT_VERSION
  ) {}

  public async get(userId: string): Promise<AiSettingsView> {
    const stored = await this.repo.find(userId);
    if (!stored.available) return this.view({ ...DEFAULT_AI_SETTINGS }, false);
    return this.view(stored.settings ?? { ...DEFAULT_AI_SETTINGS }, true);
  }

  /**
   * True only when the account agreed to the current consent version. Without
   * the table (owner SQL pending) nobody has a durable consent.
   */
  public async hasCurrentConsent(userId: string): Promise<boolean> {
    const stored = await this.repo.find(userId);
    return stored.available && stored.settings?.egressConsentVersion === this.currentConsentVersion;
  }

  public async update(userId: string, patch: AiSettingsPatch): Promise<AiSettingsView> {
    const version = patch.egressConsentVersion;
    if (version !== undefined && version !== null && version !== this.currentConsentVersion) {
      // The app showed an older (or unknown) consent text: it must show the
      // current one and ask again.
      throw AppError.conflict(
        'AI_CONSENT_VERSION_MISMATCH',
        'The AI consent text has changed. Please review it again.'
      );
    }
    const result = await this.repo.update(userId, patch);
    if (!result.available) {
      throw new AppError({
        httpStatus: 503,
        code: 'AI_SETTINGS_UNAVAILABLE',
        safeMessage: 'AI settings cannot be saved yet. Please try again later.',
        isOperational: true
      });
    }
    if (!result.settings) {
      throw AppError.notFound('Account not found');
    }
    return this.view(result.settings, true);
  }

  private view(settings: AiSettings, available: boolean): AiSettingsView {
    return { settings, currentConsentVersion: this.currentConsentVersion, available };
  }
}
