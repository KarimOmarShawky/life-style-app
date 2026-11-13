/**
 * src/features/ai/ai-assistant.validation.ts
 *
 * Strict body of POST /api/v1/ai/assistant/turn and /turn/stream (AI-2b).
 * The same size budget as the chat proxy: at most 20 earlier turns plus the
 * new message, 4,000 characters each, 24,000 in total.
 */
import { z } from 'zod';
import { AI_CONTEXT_SCOPES } from './application/ai-context-builder.js';
import { AI_LIMITS } from './ai.types.js';

const MAX_CONVERSATION_TURNS = AI_LIMITS.maxMessages - 1;

const textSchema = z
  .string()
  .max(AI_LIMITS.maxMessageChars, `At most ${AI_LIMITS.maxMessageChars} characters`)
  .refine((value) => value.trim().length > 0, 'Must not be empty');

export const aiAssistantTurnSchema = z
  .object({
    message: textSchema,
    conversation: z
      .array(z.object({ role: z.enum(['user', 'model']), text: textSchema }).strict())
      .max(MAX_CONVERSATION_TURNS, `At most ${MAX_CONVERSATION_TURNS} earlier turns`)
      .optional(),
    contextScopes: z
      .array(z.enum(AI_CONTEXT_SCOPES))
      .max(AI_CONTEXT_SCOPES.length)
      .refine((scopes) => new Set(scopes).size === scopes.length, 'Scopes must be unique')
      .optional(),
    clientLocale: z
      .string()
      .max(16)
      .regex(/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{1,8})*$/, 'Must be a BCP-47 locale')
      .optional()
  })
  .strict()
  .superRefine((body, ctx) => {
    const total =
      body.message.length + (body.conversation ?? []).reduce((sum, t) => sum + t.text.length, 0);
    if (total > AI_LIMITS.maxTotalChars) {
      ctx.addIssue({
        code: 'custom',
        path: ['conversation'],
        message: `At most ${AI_LIMITS.maxTotalChars} characters in total`
      });
    }
  });

export type AiAssistantTurnBody = z.infer<typeof aiAssistantTurnSchema>;
