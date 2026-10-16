import type { Server } from 'node:http';

interface ResetDrain {
  stopResetRequests(): void;
  waitForResetRequests(): Promise<void>;
}

/** Keep dependencies alive until EVERY HTTP listener and accepted reset job drains. */
export async function drainApiWork(servers: readonly Server[], reset: ResetDrain): Promise<void> {
  reset.stopResetRequests();
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            // An auxiliary bind may have failed; it owns no listener to drain.
            if (error && !('code' in error && error.code === 'ERR_SERVER_NOT_RUNNING'))
              reject(error);
            else resolve();
          });
        })
    )
  );
  await reset.waitForResetRequests();
}
