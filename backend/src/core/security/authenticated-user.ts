/**
 * The authenticated principal attached to a request.
 *
 * Deliberately small. It holds what authorization decisions need and nothing
 * else, because every field here came from a JWT the client presented, and the
 * JWT payload is kept minimal by spec section 10.
 *
 * Anything beyond identity and role is read from the database at the point of
 * use, so a stale or tampered token cannot widen access.
 */
export type UserRole = 'user' | 'admin';

export interface AuthenticatedUser {
  /** PostgreSQL users.id. The source of truth for ownership checks. */
  readonly id: string;
  readonly email: string;
  readonly role: UserRole;
  /** Session id (`jti` of the refresh token family) for revocation. */
  readonly sessionId: string;
  /** Token issued-at, epoch seconds. Compared against password-change time. */
  readonly issuedAt: number;
}

export const USER_ROLES: readonly UserRole[] = ['user', 'admin'] as const;

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}
