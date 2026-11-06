import type { RequestHandler } from 'express';
import { errorResponse } from '../http/envelope.js';

/**
 * Product retirement boundary. Preserve existing data and allow subscription
 * management and old-client token revocation, but never accept new wallet/SMS
 * work, financial transactions, budgets, categories, reports or payments.
 * This is mounted at the production HTTP boundary, not a data migration.
 */
const retired: RequestHandler = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(410).json(
    errorResponse({
      code: 'FEATURE_RETIRED',
      message: 'This feature is no longer available.',
      requestId: req.id || 'unknown'
    })
  );
};

export const retiredIngestGuard: RequestHandler = (req, res, next) => {
  if (req.method === 'DELETE' && /^\/token\/?$/.test(req.path)) {
    next();
    return;
  }
  retired(req, res, next);
};

export const retiredMoneyGuard: RequestHandler = (req, res, next) => {
  const collection = /^\/subscriptions\/?$/.test(req.path);
  const item = /^\/subscriptions\/[^/]+\/?$/.test(req.path);
  const allowed =
    ((req.method === 'GET' || req.method === 'HEAD') && (collection || item)) ||
    (req.method === 'POST' && collection) ||
    ((req.method === 'PATCH' || req.method === 'DELETE') && item);
  if (allowed) {
    next();
    return;
  }
  retired(req, res, next);
};
