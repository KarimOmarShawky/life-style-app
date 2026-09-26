/**
 * Auth persistence (spec section 4).
 *
 * Every statement here is parameterized. There is no string concatenation of
 * user input anywhere in this file, which is what makes SQL injection
 * structurally impossible rather than a thing to remember (spec section 14).
 *
 * The repository returns domain records and knows nothing about HTTP. It also
 * performs no authorization: that belongs to the service, which has the caller's
 * identity. The one exception is that ownership predicates are pushed INTO the
 * SQL where they exist, because a filter the database applies cannot be skipped
 * by a later refactor.
 */
import { createHash } from 'node:crypto';

import { query, withTransaction, type PoolClient } from '@/infrastructure/database/postgres/pool';
import type { UserRole } from '@/core/security/authenticated-user';

import type { RevocationReason, StoredRefreshToken, UserRecord } from './auth.types';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  role: string;
  is_active: boolean;
  failed_login_attempts: number;
  locked_until: Date | null;
  password_changed_at: Date;
  created_at: Date;
  updated_at: Date;
}

const USER_COLUMNS = `
  id, email, password_hash, display_name, role, is_active,
  failed_login_attempts, locked_until, password_changed_at, created_at, updated_at
`;

function toUserRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    role: row.role as UserRole,
    isActive: row.is_active,
    failedLoginAttempts: row.failed_login_attempts,
    lockedUntil: row.locked_until,
    passwordChangedAt: row.password_changed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Refresh tokens are stored as a SHA-256 digest. See migration 002 for why a
 * fast hash is the right choice for a high-entropy token.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function findUserByEmail(email: string): Promise<UserRecord | undefined> {
  const result = await query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE email = $1`, [
    email,
  ]);
  const row = result.rows[0];
  return row ? toUserRecord(row) : undefined;
}

export async function findUserById(id: string): Promise<UserRecord | undefined> {
  const result = await query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
  const row = result.rows[0];
  return row ? toUserRecord(row) : undefined;
}

export async function insertUser(input: {
  email: string;
  passwordHash: string;
  displayName: string | null;
}): Promise<UserRecord> {
  const result = await query<UserRow>(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ($1, $2, $3)
     RETURNING ${USER_COLUMNS}`,
    [input.email, input.passwordHash, input.displayName],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('INSERT ... RETURNING produced no row');
  }
  return toUserRecord(row);
}

/**
 * Records a failed login and locks the account once the threshold is reached.
 *
 * Done in ONE statement so the increment and the threshold test cannot race.
 * A read-modify-write would let concurrent attempts each read the same count
 * and collectively overshoot the limit, which is exactly the hole an online
 * brute-force attack drives through (spec section 32).
 */
export async function registerFailedLogin(
  userId: string,
  maxAttempts: number,
  lockoutSeconds: number,
): Promise<{ attempts: number; lockedUntil: Date | null }> {
  const result = await query<{ failed_login_attempts: number; locked_until: Date | null }>(
    `UPDATE users
        SET failed_login_attempts = failed_login_attempts + 1,
            locked_until = CASE
              WHEN failed_login_attempts + 1 >= $2 THEN now() + make_interval(secs => $3)
              ELSE locked_until
            END
      WHERE id = $1
      RETURNING failed_login_attempts, locked_until`,
    [userId, maxAttempts, lockoutSeconds],
  );

  const row = result.rows[0];
  return {
    attempts: row?.failed_login_attempts ?? 0,
    lockedUntil: row?.locked_until ?? null,
  };
}

/** Clears lockout state after a successful login. */
export async function clearFailedLogins(userId: string): Promise<void> {
  await query(
    `UPDATE users
        SET failed_login_attempts = 0, locked_until = NULL
      WHERE id = $1 AND (failed_login_attempts <> 0 OR locked_until IS NOT NULL)`,
    [userId],
  );
}

export async function updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
  await query(
    `UPDATE users
        SET password_hash = $2, password_changed_at = now(),
            failed_login_attempts = 0, locked_until = NULL
      WHERE id = $1`,
    [userId, passwordHash],
  );
}

// --- Refresh tokens -------------------------------------------------------

export async function insertRefreshToken(
  input: {
    id: string;
    userId: string;
    sessionId: string;
    token: string;
    expiresAt: Date;
    ipAddress: string | null;
    userAgent: string | null;
  },
  client?: PoolClient,
): Promise<void> {
  const sql = `
    INSERT INTO refresh_tokens (id, user_id, session_id, token_hash, expires_at, ip_address, user_agent)
    VALUES ($1, $2, $3, $4, $5, $6, $7)`;
  const params = [
    input.id,
    input.userId,
    input.sessionId,
    hashRefreshToken(input.token),
    input.expiresAt,
    input.ipAddress,
    input.userAgent,
  ];

  if (client) {
    await client.query(sql, params);
    return;
  }
  await query(sql, params);
}

interface RefreshTokenRow {
  id: string;
  user_id: string;
  session_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  revoked_reason: string | null;
}

export async function findRefreshTokenById(id: string): Promise<StoredRefreshToken | undefined> {
  const result = await query<RefreshTokenRow>(
    `SELECT id, user_id, session_id, expires_at, revoked_at, revoked_reason
       FROM refresh_tokens WHERE id = $1`,
    [id],
  );

  const row = result.rows[0];
  if (!row) {
    return undefined;
  }

  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
  };
}

/**
 * Atomically rotates a refresh token.
 *
 * The UPDATE carries `revoked_at IS NULL` in its WHERE clause and reports how
 * many rows it changed. Two concurrent refreshes with the same token therefore
 * produce exactly one winner: the second matches zero rows and the caller treats
 * that as reuse. Checking "is it revoked?" first and updating afterwards would
 * let both pass the check (spec section 32, token refresh races).
 *
 * Returns false when the token was already revoked or does not exist.
 */
export async function rotateRefreshToken(input: {
  oldTokenId: string;
  newTokenId: string;
  userId: string;
  sessionId: string;
  newToken: string;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<boolean> {
  return withTransaction(async (tx) => {
    // STATEMENT ORDER MATTERS, for two separate reasons.
    //
    // 1. The revoking UPDATE comes first because its `revoked_at IS NULL`
    //    predicate is the serialization point. Two concurrent refreshes with the
    //    same token both reach it; exactly one matches a row and the loser sees
    //    rowCount 0 and is reported as reuse.
    //
    // 2. `replaced_by` is set in a SECOND update, after the new row exists.
    //    It is a self-referencing foreign key, so pointing at the new id before
    //    inserting that row violates the constraint and fails the whole refresh.
    const revoked = await tx.query(
      `UPDATE refresh_tokens
          SET revoked_at = now(), revoked_reason = 'rotated'
        WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [input.oldTokenId],
    );

    if (revoked.rowCount !== 1) {
      return false;
    }

    await insertRefreshToken(
      {
        id: input.newTokenId,
        userId: input.userId,
        sessionId: input.sessionId,
        token: input.newToken,
        expiresAt: input.expiresAt,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      tx,
    );

    // Now that the successor row exists, the audit link can be recorded.
    await tx.query('UPDATE refresh_tokens SET replaced_by = $2 WHERE id = $1', [
      input.oldTokenId,
      input.newTokenId,
    ]);

    return true;
  });
}

/** Revokes every live token in one session family. */
export async function revokeSession(sessionId: string, reason: RevocationReason): Promise<number> {
  const result = await query(
    `UPDATE refresh_tokens
        SET revoked_at = now(), revoked_reason = $2
      WHERE session_id = $1 AND revoked_at IS NULL`,
    [sessionId, reason],
  );
  return result.rowCount ?? 0;
}

/** Revokes every live token for a user, across all their devices. */
export async function revokeAllUserSessions(
  userId: string,
  reason: RevocationReason,
): Promise<number> {
  const result = await query(
    `UPDATE refresh_tokens
        SET revoked_at = now(), revoked_reason = $2
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, reason],
  );
  return result.rowCount ?? 0;
}

/** Housekeeping: drops rows that are long past use. */
export async function deleteExpiredRefreshTokens(olderThanDays = 30): Promise<number> {
  const result = await query(
    `DELETE FROM refresh_tokens
      WHERE expires_at < now() - make_interval(days => $1)`,
    [olderThanDays],
  );
  return result.rowCount ?? 0;
}
