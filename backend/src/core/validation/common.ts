/**
 * Validation primitives shared across features.
 *
 * Defined once so that "what a valid id looks like" has a single answer. A
 * feature that rolls its own is how one endpoint ends up accepting an id shape
 * the rest of the system rejects.
 */
import { z } from 'zod';

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@/core/utils/pagination';

/** A PostgreSQL-generated UUID. */
export const uuidSchema = z.string().uuid('must be a valid UUID');

/** Route parameter `:id`. */
export const idParamSchema = z.object({ id: uuidSchema }).strict();

/**
 * A MongoDB ObjectId, as a 24-character hex string.
 *
 * Notes live in MongoDB, so their ids are not UUIDs. Checked with a pattern
 * rather than by calling into the driver, so this module stays free of a
 * database dependency and can be used before a connection exists.
 */
export const objectIdSchema = z.string().regex(/^[0-9a-f]{24}$/i, 'must be a valid resource id');

/** Route parameter `:id` for a MongoDB-backed resource. */
export const objectIdParamSchema = z.object({ id: objectIdSchema }).strict();

/**
 * Standard list query.
 *
 * `limit` is coerced because query strings are always text. It is capped by the
 * schema as well as by `toPageRequest`, so an absurd value is rejected early
 * rather than silently clamped when the caller might want to know.
 */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor: z.string().min(1).max(500).optional(),
});

/**
 * A trimmed, non-empty string with a length cap.
 *
 * Trimming at validation is what stops a title of only spaces reaching the
 * database and failing its `btrim(title) <> ''` constraint as a 500.
 */
export function trimmedString(max: number, label: string): z.ZodString {
  return z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(1, `${label} must not be empty`)
    .max(max, `${label} must be at most ${max} characters`);
}

/**
 * An optional text field that accepts null to mean "clear this value".
 *
 * PATCH needs three distinct states: absent (leave alone), null (clear), and a
 * value (set). Modelling null and undefined as the same thing would make it
 * impossible to clear a description once set.
 */
export function nullableText(
  max: number,
  label: string,
): z.ZodOptional<z.ZodNullable<z.ZodString>> {
  return z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .nullable()
    .optional();
}

/** An ISO 8601 date-time, validated as a real instant rather than just a string. */
export const isoDateTimeSchema = z
  .string()
  .datetime({ offset: true, message: 'must be an ISO 8601 date-time, e.g. 2026-09-24T09:00:00Z' });

/** A calendar date with no time component. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in YYYY-MM-DD form')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'must be a real date');
