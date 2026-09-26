/**
 * src/infrastructure/redis/redis-client.ts
 *
 * Implements Section 4.1, 4.8 & 12: Redis client wrapper.
 * Connects to Redis 7 for rate limiting, OTP storage, and BullMQ queues.
 * Strictly never used for primary business data storage.
 */

import { Redis } from 'ioredis';
import { getEnv } from '../../config/env.js';
import { logger } from '../../core/logger/logger.js';

let redisInstance: Redis | null = null;

export function getRedisClient(): Redis {
  if (redisInstance) {
    return redisInstance;
  }

  const env = getEnv();

  redisInstance = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectTimeout: 5000,
    lazyConnect: false,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 2000);
      return delay;
    }
  });

  redisInstance.on('error', (err) => {
    logger.warn('Redis connection event error', { err: String(err) });
  });

  redisInstance.on('connect', () => {
    logger.info('Connected to Redis server.');
  });

  return redisInstance;
}

export async function checkRedisHealth(client?: Redis, timeoutMs = 1000): Promise<boolean> {
  const redis = client ?? getRedisClient();
  try {
    const pingPromise = redis.ping();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Redis ping timeout')), timeoutMs)
    );

    const result = await Promise.race([pingPromise, timeoutPromise]);
    return result === 'PONG';
  } catch (err) {
    logger.warn('Redis health check probe failed', { err: String(err) });
    return false;
  }
}

export async function closeRedisClient(client?: Redis): Promise<void> {
  const redis = client ?? redisInstance;
  if (redis) {
    logger.info('Closing Redis connection...');
    await redis.quit();
    if (redis === redisInstance) {
      redisInstance = null;
    }
    logger.info('Redis connection closed successfully.');
  }
}
