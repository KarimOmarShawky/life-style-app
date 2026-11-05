import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';

/**
 * Optional compatibility fence for a wallet queue record that carries its
 * authenticated owner's UUID. This is a request precondition, NOT an identity
 * credential: authentication still establishes req.user. The absent-header
 * case deliberately remains compatible with legacy clients, so this alone does
 * not protect old queue entries. Never infer an owner for those entries.
 */
export const walletOwnerPrecondition: RequestHandler = (req, res, next) => {
  const expected = req.get('X-Wallet-Owner');
  if (expected === undefined) return next();
  res.setHeader('Cache-Control', 'no-store');
  const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    !canonicalUuid.test(expected) ||
    !req.user ||
    expected.toLowerCase() !== req.user.id.toLowerCase()
  ) {
    return next(
      new AppError({
        httpStatus: 428,
        code: 'WALLET_OWNER_MISMATCH',
        safeMessage: 'Wallet item cannot be processed for this account',
        isOperational: true
      })
    );
  }
  return next();
};
