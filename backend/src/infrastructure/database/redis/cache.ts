/**
 * Cache helper with an explicit key convention (spec section 9).
 *
 * Key format: `lifestyle:v1:<scope>:<identifier>[:<qualifier>]`
 *
 *   lifestyle  namespace, so a shared Redis is not ambiguous
 *   v1         schema version, bumped to invalidate every key at once after a
 *              shape change, which is cheaper and safer than a migration script
 *   scope      the owning feature, e.g. `user`, `dashboard`
 *   identifier the resource id, and for user-owned data the USER id
 *
 * The user id in the key is a security control, not an organizing convenience.
 * A cache keyed only by resource id serves one user's data to another as soon as
 * two users request the same path. Every helper below therefore demands a scope.
 *
 * Never cached: passwords, tokens, secrets, or anything a different user must
 * not see. Cache failures are swallowed and logged, because a broken cache must
 * degrade into a slower request, never a failed one.
 *
 * WHAT IS ACTUALLY CACHED, as of now: revoked sessions, and nothing else. A
 * `user` projection key and a `dashboard` key were sketched here before either
 * feature existed, and eleven services grew a call invalidating the first one —
 * which nothing ever wrote, so every one of those calls was a Redis round trip
 * on every write in exchange for nothing. Both keys are gone, along with the
 * calls. DD-027 records why the dashboard is computed rather than cached, and
 * what would have to be true for that to change.
 *
 * The helpers below are deliberately kept: they are a small, tested toolkit, and
 * the next thing worth caching should not have to reinvent them. A key belongs
 * here when something reads it.
 */
import { config } from '@/config';
import { createLogger } from '@/core/logger';

import { getRedis } from './client';

const log = createLogger('cache');

const NAMESPACE = 'lifestyle';
const VERSION = 'v1';

export const CacheKey = {
  /** Failed-login counter, keyed by the account being attacked. */
  loginAttempts: (email: string): string => `${NAMESPACE}:${VERSION}:login-attempts:${email}`,
  /** Revoked session marker, so an access token can be rejected before expiry. */
  revokedSession: (sessionId: string): string =>
    `${NAMESPACE}:${VERSION}:revoked-session:${sessionId}`,
  /** Everything owned by one user, for bulk invalidation. */
  userScopePattern: (userId: string): string => `${NAMESPACE}:${VERSION}:*:${userId}*`,
} as const;

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const redis = getRedis();
  if (!redis) {
    return undefined;
  }

  try {
    const raw = await redis.get(key);
    if (raw === null) {
      return undefined;
    }
    return JSON.parse(raw) as T;
  } catch (error) {
    // A corrupt entry must not poison every later read, so it is dropped.
    log.warn({ err: error, key }, 'Cache read failed; treating as a miss');
    return undefined;
  }
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number = config.CACHE_DEFAULT_TTL_SECONDS,
): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    return;
  }

  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (error) {
    log.warn({ err: error, key }, 'Cache write failed; continuing without caching');
  }
}

/** Invalidates a key. Call after any mutation of the data it holds. */
export async function cacheDelete(...keys: string[]): Promise<void> {
  const redis = getRedis();
  if (!redis || keys.length === 0) {
    return;
  }

  try {
    await redis.del(...keys);
  } catch (error) {
    log.warn({ err: error, keys }, 'Cache invalidation failed');
  }
}

/**
 * Deletes every key matching a pattern, using SCAN rather than KEYS.
 *
 * KEYS blocks the single-threaded Redis server for the whole sweep, which on a
 * large keyspace stalls every other client. SCAN yields between batches.
 */
export async function cacheDeletePattern(pattern: string): Promise<number> {
  const redis = getRedis();
  if (!redis) {
    return 0;
  }

  let deleted = 0;
  let cursor = '0';

  try {
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      if (keys.length > 0) {
        deleted += await redis.del(...keys);
      }
    } while (cursor !== '0');
  } catch (error) {
    log.warn({ err: error, pattern }, 'Pattern invalidation failed');
  }

  return deleted;
}

/**
 * Read-through cache. Returns the cached value when present, otherwise runs
 * `produce`, stores the result, and returns it.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  produce: () => Promise<T>,
): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== undefined) {
    return hit;
  }

  const value = await produce();
  await cacheSet(key, value, ttlSeconds);
  return value;
}
