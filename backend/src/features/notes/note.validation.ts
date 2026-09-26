/**
 * Note request schemas (spec sections 13 and 15).
 *
 * These schemas are also the MongoDB injection defence. The validate middleware
 * replaces `req.body` and `req.query` with what Zod returns, so a payload
 * carrying `{ "title": { "$ne": null } }` fails the string check and never
 * reaches a query object. Nothing downstream has to remember to guard against
 * operator objects, because one cannot get that far.
 */
import { z } from 'zod';

import { paginationQuerySchema, trimmedString, uuidSchema } from '@/core/validation/common';

const MAX_TAGS = 25;
const MAX_TAG_LENGTH = 40;
const MAX_CONTENT_LENGTH = 100_000;

/**
 * Tags, normalized.
 *
 * Lowercased and deduplicated so that "Work", "work" and "WORK" are one tag.
 * Without this, filtering by tag becomes a guessing game about how the tag was
 * capitalized when it was first typed. The array cap is enforced after
 * deduplication, so 30 copies of one tag is not an error.
 */
const tagsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1, 'a tag must not be empty')
      .max(MAX_TAG_LENGTH, `a tag must be at most ${MAX_TAG_LENGTH} characters`),
  )
  .max(200, 'too many tags supplied')
  .transform((tags) => [...new Set(tags.map((tag) => tag.toLowerCase()))])
  .refine((tags) => tags.length <= MAX_TAGS, {
    message: `a note may have at most ${MAX_TAGS} distinct tags`,
  });

/**
 * Note body text.
 *
 * Not trimmed: leading indentation in a note is content the user typed on
 * purpose, unlike a title where surrounding spaces are always an accident.
 */
const contentSchema = z
  .string()
  .max(MAX_CONTENT_LENGTH, `content must be at most ${MAX_CONTENT_LENGTH} characters`);

/** A link to a PostgreSQL row: absent leaves it, null clears it, a UUID sets it. */
const linkSchema = uuidSchema.nullable().optional();

export const createNoteSchema = z
  .object({
    title: trimmedString(200, 'title'),
    content: contentSchema.optional(),
    tags: tagsSchema.optional(),
    projectId: linkSchema,
    taskId: linkSchema,
  })
  .strict();

export const updateNoteSchema = z
  .object({
    title: trimmedString(200, 'title').optional(),
    content: contentSchema.optional(),
    tags: tagsSchema.optional(),
    projectId: linkSchema,
    taskId: linkSchema,
    isArchived: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'provide at least one field to update',
  });

/**
 * List query.
 *
 * `.strict()` rejects an unknown key rather than ignoring it, so a client
 * filtering by a parameter this endpoint does not implement is told so instead
 * of silently receiving every note.
 */
export const listNotesQuerySchema = paginationQuerySchema
  .extend({
    tag: z.string().trim().min(1).max(MAX_TAG_LENGTH).toLowerCase().optional(),
    search: z.string().trim().min(1).max(200).optional(),
    projectId: uuidSchema.optional(),
    taskId: uuidSchema.optional(),
    // Query strings carry text, never booleans. Accepting only these two spellings
    // keeps "?archived=maybe" an error rather than a silent false.
    archived: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
  })
  .strict();

export type CreateNoteBody = z.infer<typeof createNoteSchema>;
export type UpdateNoteBody = z.infer<typeof updateNoteSchema>;
export type ListNotesQuery = z.infer<typeof listNotesQuerySchema>;
