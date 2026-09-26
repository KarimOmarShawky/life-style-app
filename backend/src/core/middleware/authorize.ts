/**
 * Authorization middleware (spec section 16).
 *
 * Authentication established WHO. These helpers decide WHETHER.
 *
 * The rule that matters most in this codebase: a resource id in the URL is
 * untrusted input. Being signed in does not entitle a caller to
 * `/tasks/<any-uuid>`. Ownership is enforced inside each repository query by
 * filtering on `user_id`, which is stronger than a middleware check because it
 * cannot be forgotten at a new call site. `assertOwnership` below is for the
 * cases where the row is already in hand.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { AppError, ErrorCode } from '@/core/errors';
import { AuditAction, recordAudit } from '@/infrastructure/database/mongodb/audit-log.service';
import type { UserRole } from '@/core/security/authenticated-user';

import { requireUser } from './authenticate';

/** Restricts a route to the listed roles (vertical privilege control). */
export function authorize(...allowed: readonly UserRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const user = requireUser(req);

      if (!allowed.includes(user.role)) {
        recordAudit({
          action: AuditAction.AUTHORIZATION_DENIED,
          outcome: 'failure',
          actorId: user.id,
          ipAddress: req.ip ?? null,
          metadata: { path: req.path, method: req.method, role: user.role, required: allowed },
        });

        throw new AppError(ErrorCode.INSUFFICIENT_PERMISSIONS, {
          metadata: { role: user.role, required: allowed },
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Asserts the caller owns a resource (horizontal privilege control).
 *
 * Throws NOT_FOUND rather than FORBIDDEN on purpose. Returning 403 for a row
 * that exists but belongs to someone else, and 404 for one that does not exist,
 * lets an attacker enumerate valid ids by watching which status comes back. Both
 * cases must be indistinguishable (spec section 16, IDOR/BOLA).
 *
 * An admin bypasses the check, and the bypass is audited.
 */
export function assertOwnership(
  req: Request,
  resourceOwnerId: string,
  resourceName = 'Resource',
): void {
  const user = requireUser(req);

  if (user.id === resourceOwnerId) {
    return;
  }

  if (user.role === 'admin') {
    recordAudit({
      action: AuditAction.AUTHORIZATION_DENIED,
      outcome: 'success',
      actorId: user.id,
      targetId: resourceOwnerId,
      ipAddress: req.ip ?? null,
      metadata: { note: 'admin accessed another user resource', path: req.path },
    });
    return;
  }

  recordAudit({
    action: AuditAction.AUTHORIZATION_DENIED,
    outcome: 'failure',
    actorId: user.id,
    targetId: resourceOwnerId,
    ipAddress: req.ip ?? null,
    metadata: { path: req.path, method: req.method, reason: 'ownership' },
  });

  throw AppError.notFound(resourceName, { attemptedBy: user.id, ownedBy: resourceOwnerId });
}
