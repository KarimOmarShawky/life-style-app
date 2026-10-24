import { describe, it, expect } from 'vitest';
import { createServer, get } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { drainApiWork } from '../../src/core/lifecycle/drain-api.js';

describe('HTTP and reset shutdown boundary', () => {
  it('ignores an unbound auxiliary server without skipping accepted reset work', async () => {
    const events: string[] = [];
    await drainApiWork([createServer()], {
      stopResetRequests: () => {
        events.push('stop');
      },
      waitForResetRequests: async () => {
        events.push('reset');
      }
    });
    expect(events).toEqual(['stop', 'reset']);
  });

  it('real SIGTERM waits for an auxiliary HTTP response AND a pending reset worker before exit', async () => {
    const drain = new URL('../../src/core/lifecycle/drain-api.ts', import.meta.url).href;
    const dispatcher = new URL(
      '../../src/core/security/reset-request-dispatcher.ts',
      import.meta.url
    ).href;
    // Actual subprocess, sockets and production drain/dispatcher code. No DB/SMTP mock is
    // represented as an infrastructure or live-provider integration success.
    const source = `
      import {createServer} from 'node:http';
      import {drainApiWork} from ${JSON.stringify(drain)};
      import {ResetRequestDispatcher} from ${JSON.stringify(dispatcher)};
      let releaseWorker, response;
      const gate = new Promise(resolve => { releaseWorker = resolve; });
      const queue = new ResetRequestDispatcher(async () => { await gate; });
      const primary = createServer((_req,res) => res.end('primary'));
      const auxiliary = createServer((_req,res) => { response = res; process.send({stage:'held'}); });
      await new Promise(resolve => primary.listen(0,'127.0.0.1',resolve));
      await new Promise(resolve => auxiliary.listen(0,'127.0.0.1',resolve));
      queue.admit({email:'owned-fixture@example.invalid'});
      process.on('message', message => {
        if(message === 'http') response.end('completed');
        if(message === 'worker') releaseWorker();
      });
      process.on('SIGTERM', () => {
        void (async () => {
          const draining = drainApiWork([primary,auxiliary], {
            stopResetRequests: () => queue.stopAccepting(),
            waitForResetRequests: () => { process.send({stage:'waiting-worker'}); return queue.waitForIdle(); }
          });
          process.send({stage:'stopping',accepted:await queue.admit({email:'late@example.invalid'})});
          await draining;
          process.send({stage:'drained'});
          process.exit(0);
        })();
      });
      process.send({stage:'ready',port:auxiliary.address().port});
    `;
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', source],
      {
        stdio: ['ignore', 'ignore', 'pipe', 'ipc']
      }
    );
    let request: ReturnType<typeof get> | undefined;
    try {
      const [ready] = await once(child, 'message');
      if (
        !ready ||
        typeof ready !== 'object' ||
        !('port' in ready) ||
        typeof ready.port !== 'number'
      ) {
        throw new Error('Owned shutdown probe did not start');
      }
      const held = once(child, 'message');
      const body = new Promise<string>((resolve, reject) => {
        request = get({ host: '127.0.0.1', port: ready.port, agent: false }, (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            text += chunk;
          });
          res.on('end', () => resolve(text));
        });
        request.on('error', reject);
      });
      expect((await held)[0]).toEqual({ stage: 'held' });
      const stopping = once(child, 'message');
      child.kill('SIGTERM');
      expect((await stopping)[0]).toEqual({ stage: 'stopping', accepted: false });
      expect(child.exitCode).toBeNull();
      const waiting = once(child, 'message');
      child.send('http');
      expect((await waiting)[0]).toEqual({ stage: 'waiting-worker' });
      expect(await body).toBe('completed');
      expect(child.exitCode).toBeNull();
      const drained = once(child, 'message');
      const exited = once(child, 'exit');
      child.send('worker');
      expect((await drained)[0]).toEqual({ stage: 'drained' });
      expect((await exited)[0]).toBe(0);
    } finally {
      request?.destroy();
      if (child.exitCode === null) {
        child.kill('SIGKILL');
        await once(child, 'exit');
      }
    }
  });
});
