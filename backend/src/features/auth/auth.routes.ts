/**
 * Auth routes (spec section 17).
 *
 * Middleware order is deliberate and security-relevant:
 *
 *   authLimiter -> validate -> controller
 *
 * The limiter runs BEFORE validation so that a flood of malformed requests is
 * rejected without paying for schema parsing. The exception is that its key
 * reads `req.body.email`, which at that point is still the raw parsed JSON; the
 * value is defensively stringified and truncated in the key generator.
 *
 * `authenticate` appears only on routes that need an identity. Login and refresh
 * must NOT require it: they are how an identity is obtained in the first place.
 */
import { Router } from 'express';

import { getContainer } from '@/core/container';
import { createAuthenticate } from '@/core/middleware/authenticate';
import { asyncHandler } from '@/core/middleware/async-handler';
import { authLimiter } from '@/core/middleware/rate-limit';
import { validate } from '@/core/middleware/validate';

import {
  changePasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
} from './auth.validation';

export function createAuthRouter(): Router {
  const router = Router();
  const { authController, tokenService } = getContainer();
  const authenticate = createAuthenticate(tokenService);

  router.post(
    '/register',
    authLimiter,
    validate({ body: registerSchema }),
    asyncHandler(authController.register),
  );

  router.post(
    '/login',
    authLimiter,
    validate({ body: loginSchema }),
    asyncHandler(authController.login),
  );

  router.post(
    '/refresh',
    authLimiter,
    validate({ body: refreshSchema }),
    asyncHandler(authController.refresh),
  );

  router.post('/logout', authenticate, asyncHandler(authController.logout));

  router.post(
    '/change-password',
    authenticate,
    authLimiter,
    validate({ body: changePasswordSchema }),
    asyncHandler(authController.changePassword),
  );

  router.get('/me', authenticate, asyncHandler(authController.me));

  return router;
}
