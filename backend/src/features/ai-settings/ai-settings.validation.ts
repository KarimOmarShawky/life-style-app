/**
 * src/features/ai-settings/ai-settings.validation.ts
 *
 * Strict partial body for PATCH /api/v1/ai/settings: unknown keys are
 * rejected and at least one field is required.
 */
import { z } from 'zod';
import { AI_LANGUAGE_MODES } from './ai-settings.types.js';

export const patchAiSettingsSchema = z
  .object({
    egressConsentVersion: z.number().int().positive().max(1000).nullable().optional(),
    memoryEnabled: z.boolean().optional(),
    explicitMemoryEnabled: z.boolean().optional(),
    learningEnabled: z.boolean().optional(),
    quickActionsEnabled: z.boolean().optional(),
    languageMode: z.enum(AI_LANGUAGE_MODES).optional()
  })
  .strict()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'At least one setting is required'
  });

export type PatchAiSettingsBody = z.infer<typeof patchAiSettingsSchema>;
