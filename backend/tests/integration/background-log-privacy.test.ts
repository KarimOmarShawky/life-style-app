import '../infrastructure-safety.js';
import { describe, expect, it, vi } from 'vitest';
import { logger } from '../../src/core/logger/logger.js';
import {
  closeRedisClient,
  getRedisClient,
  checkRedisHealth
} from '../../src/infrastructure/redis/redis-client.js';

const secret = 'private.person@example.com';

describe('background errors do not disclose provider details', () => {
  it('redacts Redis connection and health errors', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const redis = getRedisClient();
    try {
      redis.emit('error', new Error(`Redis secret ${secret}`));
      const result = await checkRedisHealth({
        ping: async () => {
          throw new Error(`probe secret ${secret}`);
        }
      } as never);
      expect(result).toBe(false);
      expect(warn).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
    } finally {
      await closeRedisClient(redis);
      warn.mockRestore();
    }
  });

  it('redacts an unhandled rejection and still shuts the worker down with failure', async () => {
    let handler: ((reason: unknown) => void) | undefined;
    const originalOn = process.on.bind(process);
    const on = vi.spyOn(process, 'on').mockImplementation(((
      event: string | symbol,
      listener: (...args: unknown[]) => void
    ) => {
      if (event === 'unhandledRejection') {
        handler = listener as (reason: unknown) => void;
        return process;
      }
      if (event === 'uncaughtException' || event === 'SIGTERM' || event === 'SIGINT')
        return process;
      return originalOn(event, listener);
    }) as typeof process.on);
    const fatal = vi.spyOn(logger, 'fatal').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    try {
      await import('../../src/worker.js');
      expect(handler).toBeDefined();
      handler!({ message: `provider secret ${secret}`, stack: `stack ${secret}` });
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1), { timeout: 8000 });
      expect(fatal).toHaveBeenCalledWith('Worker unhandled rejection', expect.anything());
      expect(JSON.stringify(fatal.mock.calls)).not.toContain(secret);
    } finally {
      on.mockRestore();
      fatal.mockRestore();
      exit.mockRestore();
    }
  });
});
