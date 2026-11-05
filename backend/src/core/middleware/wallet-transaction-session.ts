import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';

/** Server-derived request identity, not proof of ownership of any SMS. */
export interface WalletTransactionSession {
  sessionId: string;
  ingestTokenId?: string;
}

/** Only strict wallet transaction routes opt in; legacy/manual routes are unchanged. */
export function walletTransactionSession(requireIngest: boolean): RequestHandler {
  return (req, _res, next) => {
    if (!req.user || !req.sessionId || (requireIngest && !req.ingestTokenId)) {
      return next(AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED'));
    }
    req.walletTransactionSession = {
      sessionId: req.sessionId,
      ...(requireIngest ? { ingestTokenId: req.ingestTokenId! } : {})
    };
    return next();
  };
}
