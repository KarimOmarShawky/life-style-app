/**
 * src/core/pagination/cursor.ts
 *
 * Implements Section 7.4 & ADR-027: Opaque cursor encoding and decoding.
 * Supports stable, insert-resilient cursor pagination with bounded cost.
 */

import { AppError } from '../errors/app-error.js';

export interface CursorPayload {
  id: string;
  timestamp: string; // ISO instant or sort value
}

export function encodeCursor(payload: CursorPayload): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as CursorPayload;

    if (!parsed || typeof parsed.id !== 'string' || typeof parsed.timestamp !== 'string') {
      throw new Error('Invalid cursor schema');
    }

    return parsed;
  } catch {
    throw AppError.validation([
      {
        field: 'cursor',
        code: 'INVALID_CURSOR',
        message: 'Supplied pagination cursor is malformed or invalid'
      }
    ]);
  }
}
