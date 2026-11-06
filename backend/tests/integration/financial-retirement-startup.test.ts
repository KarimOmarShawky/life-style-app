import '../infrastructure-safety.js';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { closePgPool, getPgPool } from '../../src/infrastructure/database/postgres/pool.js';

describe('process startup against an old pre-erasure database', () => {
  afterAll(async () => closePgPool());

  for (const entry of ['server', 'worker'] as const) {
    it(`${entry} refuses to start before the atomic retirement marker exists`, async () => {
      const before = await getPgPool().query<{ marker: string | null }>(
        `SELECT to_regclass('public.financial_retirement_state')::text AS marker`
      );
      expect(before.rows[0]!.marker).toBeNull();
      const file = fileURLToPath(new URL(`../../src/${entry}.ts`, import.meta.url));
      const child = spawn(process.execPath, ['--import', 'tsx', file], {
        env: { ...process.env, NODE_ENV: 'test', REQUIRE_FINANCIAL_RETIREMENT: 'true' },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
      try {
        const code = await new Promise<number | null>((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', resolve);
        });
        expect(code).toBe(1);
        expect(output).toContain(
          'Financial retirement verification failed; service startup blocked'
        );
        expect(output).not.toContain('LifeStyle API server listening');
        expect(output).not.toContain('Starting LifeStyle Worker process');
      } finally {
        clearTimeout(timer);
        if (child.exitCode === null) child.kill('SIGKILL');
      }
    }, 15_000);
  }
});
