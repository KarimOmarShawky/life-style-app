/**
 * Redis connection (spec section 9).
 *
 * Redis is OPTIONAL. When `REDIS_URL` is unset the application still runs, with
 * rate limiting falling back to per-process memory and caching disabled. That
 * keeps local development free of another service to install, and it is why
 * `env.ts` makes the variable mandatory in production: per-process counters are
 * wrong the moment there is more than one instance.
 *
 * Redis is never the source of truth. Everything here is reconstructible from
 * PostgreSQL or MongoDB, so losing the cache costs latency, never data.
 */
import Redis, { type RedisOptions } from 'ioredis';

import { config } from '@/config';
import { createLogger, maskConnectionString } from '@/core/logger';

const log = createLogger('redis');

let client: Redis | undefined;
let unavailable = false;

function buildOptions(): RedisOptions {
  return {
    // Fail fast rather than queueing commands forever behind a dead server.
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    connectTimeout: 5000,
    lazyConnect: true,
    retryStrategy(times) {
      if (times > 10) {
        return null; // stop retrying; the circuit stays open until restart
      }
      return Math.min(times * 200, 3000);
    },
  };
}

/** The shared client, or undefined when Redis is not configured or is down. */
export function getRedis(): Redis | undefined {
  if (!config.REDIS_URL || unavailable) {
    return undefined;
  }
  return client;
}

export async function connectRedis(): Promise<void> {
  if (!config.REDIS_URL) {
    log.warn('REDIS_URL not set: caching disabled, rate limiting will use in-memory counters');
    return;
  }

  client = new Redis(config.REDIS_URL, buildOptions());

  client.on('error', (error: Error) => {
    // Logged at warn, not error: Redis being down degrades the service, it does
    // not break it. Escalating would page someone for a recoverable condition.
    log.warn({ err: error }, 'Redis error');
  });

  client.on('end', () => {
    log.warn('Redis connection closed');
  });

  try {
    await client.connect();
    await client.ping();
    log.info({ url: maskConnectionString(config.REDIS_URL) }, 'Redis connected');
  } catch (error) {
    unavailable = true;
    log.error({ err: error }, 'Redis unavailable at startup; continuing in degraded mode');
  }
}

export async function pingRedis(): Promise<boolean> {
  const redis = getRedis();
  if (!redis) {
    return false;
  }
  try {
    const reply = await redis.ping();
    return reply === 'PONG';
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  if (!client) {
    return;
  }
  const current = client;
  client = undefined;
  try {
    await current.quit();
    log.info('Redis connection closed cleanly');
  } catch {
    current.disconnect();
  }
}
