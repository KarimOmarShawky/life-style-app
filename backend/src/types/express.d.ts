/**
 * Express request augmentation.
 *
 * Declared once here so controllers read `req.user.id` with full type safety and
 * never cast. `user` is optional at the type level on purpose: it is only set
 * after `authenticate` has run, and making it non-optional would let a handler
 * on an unprotected route read it without the compiler objecting.
 */
import type { AuthenticatedUser } from '@/core/security/authenticated-user';

declare global {
  namespace Express {
    interface Request {
      /** Correlation id for this request. Always set by requestIdMiddleware. */
      requestId: string;
      /** The authenticated principal. Set only by the `authenticate` middleware. */
      user?: AuthenticatedUser;
    }
  }
}

export {};
