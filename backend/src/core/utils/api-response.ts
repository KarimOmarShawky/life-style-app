/**
 * The success half of the response envelope (spec section 17).
 *
 * Errors use the mirror-image shape from AppError.toClientJSON, so the Flutter
 * client can branch on one boolean before parsing anything else:
 *
 *   { "success": true,  "data": ... }
 *   { "success": false, "error": { "code": ..., "message": ... } }
 */
import type { Response } from 'express';

export interface Paginated<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export function sendSuccess<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ success: true, data });
}

export function sendCreated<T>(res: Response, data: T): void {
  sendSuccess(res, data, 201);
}

export function sendNoContent(res: Response): void {
  res.status(204).end();
}

export function sendPaginated<T>(res: Response, page: Paginated<T>): void {
  res.status(200).json({
    success: true,
    data: page.items,
    pagination: {
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    },
  });
}
