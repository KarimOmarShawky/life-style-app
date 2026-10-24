import type { RequestHandler, Response } from 'express';

function isEnvelope(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'success' in value;
}

/** Applies the v1 success envelope at the HTTP boundary, leaving binary/streaming
 * responses and the documented account-export exception untouched. */
export const successEnvelopeMiddleware: RequestHandler = (req, res, next) => {
  if (/\/users\/me\/export(?:\/archive)?(?:\?|$)/.test(req.originalUrl)) {
    next();
    return;
  }

  const response = res as Response & { json: Response['json'] };
  const originalJson = response.json.bind(response);
  response.json = ((body?: unknown) => {
    if (body === undefined || isEnvelope(body)) return originalJson(body);
    if (typeof body === 'object' && body !== null && 'data' in body && Array.isArray(body.data)) {
      if ('meta' in body) {
        return originalJson({ success: true, data: body.data, meta: body.meta });
      }
      return originalJson({ success: true, data: body.data });
    }
    return originalJson({ success: true, data: body });
  }) as Response['json'];
  next();
};
