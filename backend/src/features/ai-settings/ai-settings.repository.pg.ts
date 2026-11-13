/**
 * src/features/ai-settings/ai-settings.repository.pg.ts
 *
 * Until the owner-run SQL creates ai_user_settings, every method reports
 * `available: false` instead of failing (G2 pattern), so reading shows the
 * defaults and the rest of the API keeps working.
 */
import type pg from 'pg';
import { logger } from '../../core/logger/logger.js';
import { isMissingSchemaObject } from '../../infrastructure/database/postgres/schema-capabilities.js';
import type {
  AiSettingsRepository,
  AiSettingsWriteResult,
  StoredAiSettings
} from './ai-settings.repository.js';
import type { AiLanguageMode, AiSettings, AiSettingsPatch } from './ai-settings.types.js';

export interface AiSettingsRow {
  egress_consent_version: number | null;
  egress_consent_at: Date | null;
  memory_enabled: boolean;
  explicit_memory_enabled: boolean;
  learning_enabled: boolean;
  quick_actions_enabled: boolean;
  language_mode: string;
}

export const AI_SETTINGS_COLUMNS =
  'egress_consent_version, egress_consent_at, memory_enabled, explicit_memory_enabled, learning_enabled, quick_actions_enabled, language_mode';

export function aiSettingsFromRow(row: AiSettingsRow): AiSettings {
  return {
    egressConsentVersion: row.egress_consent_version,
    egressConsentAt: row.egress_consent_at ? new Date(row.egress_consent_at).toISOString() : null,
    memoryEnabled: row.memory_enabled,
    explicitMemoryEnabled: row.explicit_memory_enabled,
    learningEnabled: row.learning_enabled,
    quickActionsEnabled: row.quick_actions_enabled,
    languageMode: row.language_mode as AiLanguageMode
  };
}

let warnedUnavailable = false;

function noteUnavailable(): void {
  if (warnedUnavailable) return;
  warnedUnavailable = true;
  // No user data: only the fact that the owner-run DDL is still pending.
  logger.warn('AI settings schema is not applied yet; defaults are used');
}

export class PgAiSettingsRepository implements AiSettingsRepository {
  constructor(private readonly pool: Pick<pg.Pool, 'query'>) {}

  public async find(userId: string): Promise<StoredAiSettings> {
    try {
      const res = await this.pool.query<AiSettingsRow>(
        `SELECT ${AI_SETTINGS_COLUMNS} FROM ai_user_settings WHERE user_id = $1`,
        [userId]
      );
      const row = res.rows[0];
      return { available: true, settings: row ? aiSettingsFromRow(row) : null };
    } catch (err) {
      if (isMissingSchemaObject(err)) {
        noteUnavailable();
        return { available: false };
      }
      throw err;
    }
  }

  public async update(userId: string, patch: AiSettingsPatch): Promise<AiSettingsWriteResult> {
    const consentGiven = patch.egressConsentVersion !== undefined;
    try {
      // One statement: the active-account check, the insert of a new row
      // (defaults for fields not sent) and the update of only the sent fields
      // of an existing row. A NULL parameter means "not sent", except the
      // consent, which has its own flag because null withdraws it.
      const res = await this.pool.query<AiSettingsRow>(
        `INSERT INTO ai_user_settings (user_id, ${AI_SETTINGS_COLUMNS})
         SELECT u.id,
                CASE WHEN $2::boolean THEN $3::integer END,
                CASE WHEN $2::boolean AND $3::integer IS NOT NULL THEN now() END,
                COALESCE($4::boolean, false),
                COALESCE($5::boolean, false),
                COALESCE($6::boolean, false),
                COALESCE($7::boolean, false),
                COALESCE($8::text, 'auto')
         FROM users u
         WHERE u.id = $1 AND u.status = 'active'
         ON CONFLICT (user_id) DO UPDATE SET
           egress_consent_version = CASE WHEN $2::boolean
             THEN EXCLUDED.egress_consent_version ELSE ai_user_settings.egress_consent_version END,
           egress_consent_at = CASE WHEN $2::boolean
             THEN EXCLUDED.egress_consent_at ELSE ai_user_settings.egress_consent_at END,
           memory_enabled = COALESCE($4::boolean, ai_user_settings.memory_enabled),
           explicit_memory_enabled = COALESCE($5::boolean, ai_user_settings.explicit_memory_enabled),
           learning_enabled = COALESCE($6::boolean, ai_user_settings.learning_enabled),
           quick_actions_enabled = COALESCE($7::boolean, ai_user_settings.quick_actions_enabled),
           language_mode = COALESCE($8::text, ai_user_settings.language_mode),
           updated_at = now()
         RETURNING ${AI_SETTINGS_COLUMNS}`,
        [
          userId,
          consentGiven,
          consentGiven ? patch.egressConsentVersion : null,
          patch.memoryEnabled ?? null,
          patch.explicitMemoryEnabled ?? null,
          patch.learningEnabled ?? null,
          patch.quickActionsEnabled ?? null,
          patch.languageMode ?? null
        ]
      );
      const row = res.rows[0];
      return { available: true, settings: row ? aiSettingsFromRow(row) : null };
    } catch (err) {
      if (isMissingSchemaObject(err)) {
        noteUnavailable();
        return { available: false };
      }
      throw err;
    }
  }
}
