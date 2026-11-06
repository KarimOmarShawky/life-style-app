import { AppError } from '../errors/app-error.js';

/** Decode the opaque cursors emitted by created-at ordered list endpoints. */
export function decodeCreatedAtCursor(raw: string): { id: string; createdAt: string } {
  try {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length % 4 !== 0) throw new Error();
    const value: unknown = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const { id, createdAt } = value as Record<string, unknown>;
    if (
      typeof id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ||
      typeof createdAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:\d{3})?Z$/.test(createdAt)
    )
      throw new Error();
    const date = new Date(createdAt);
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== `${createdAt.slice(0, 23)}Z`)
      throw new Error();
    // Keep all six fractional digits for PostgreSQL; JS Date truncates them.
    return { id, createdAt };
  } catch {
    throw AppError.validation([{ field: 'cursor', message: 'Invalid cursor' }]);
  }
}
