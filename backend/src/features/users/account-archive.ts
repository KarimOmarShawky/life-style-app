import { createHash } from 'node:crypto';
import type pg from 'pg';
import { AppError } from '../../core/errors/app-error.js';
import { ACCOUNT_ARCHIVE_SOURCES, ACCOUNT_ARCHIVE_EXCLUSIONS } from './account-archive.sources.js';

export const ACCOUNT_ARCHIVE_LIMITS = {
  fetchRows: 32,
  recordBytes: 512 * 1024,
  totalBytes: 128 * 1024 * 1024,
  footerReserveBytes: 4096,
  durationMs: 60_000,
  queryMs: 5000,
  concurrentPerProcess: 2
} as const;

export interface AccountArchiveSummary {
  counts: Record<string, number>;
  records: number;
  bytesBeforeComplete: number;
  sha256: string;
}

const activeUsers = new Set<string>();
function interrupted(): AppError {
  return AppError.serviceUnavailable('Account archive interrupted; retry later');
}

/** Bounded cursor reads on one read-only repeatable-read connection, never an accumulated archive. */
export async function* streamAccountArchive(
  pool: pg.Pool,
  userId: string,
  requestedSignal: AbortSignal
): AsyncGenerator<string, AccountArchiveSummary | undefined> {
  const signal = AbortSignal.any([
    requestedSignal,
    AbortSignal.timeout(ACCOUNT_ARCHIVE_LIMITS.durationMs)
  ]);
  if (signal.aborted) throw interrupted();
  if (activeUsers.has(userId) || activeUsers.size >= ACCOUNT_ARCHIVE_LIMITS.concurrentPerProcess) {
    throw AppError.rateLimited(60, 'Account archive capacity is busy; retry later');
  }
  activeUsers.add(userId);
  let client: pg.PoolClient | undefined;
  let released = false;
  let transaction = false;
  let connectionFailed = false;
  const destroy = () => {
    if (client && !released) {
      released = true;
      client.release(true);
    }
  };
  const onConnectionError = () => {
    connectionFailed = true;
    destroy();
  };
  const run = async (text: string, values: unknown[] = []) => {
    if (signal.aborted || connectionFailed || !client || released) throw interrupted();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      return await Promise.race([
        client.query<{ payload: string | null }>(text, values),
        new Promise<never>((_resolve, reject) => {
          onAbort = () => {
            destroy();
            reject(interrupted());
          };
          signal.addEventListener('abort', onAbort, { once: true });
          timer = setTimeout(onAbort, ACCOUNT_ARCHIVE_LIMITS.queryMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  };
  const counts: Record<string, number> = Object.fromEntries(
    ACCOUNT_ARCHIVE_SOURCES.map((s) => [s.section, 0])
  );
  let bytes = 0;
  let records = 0;
  const hash = createHash('sha256');
  const encode = (frame: unknown): string => {
    if (signal.aborted || connectionFailed) throw interrupted();
    const line = JSON.stringify(frame) + '\n';
    bytes += Buffer.byteLength(line);
    if (bytes > ACCOUNT_ARCHIVE_LIMITS.totalBytes - ACCOUNT_ARCHIVE_LIMITS.footerReserveBytes) {
      throw AppError.payloadTooLarge('Account archive exceeds the synchronous export limit');
    }
    hash.update(line);
    return line;
  };
  try {
    // Pool connectionTimeoutMillis bounds acquisition; a late acquired connection is discarded on abort.
    client = await pool.connect();
    // Checked-out pg clients can emit asynchronous idle/connection errors while HTTP is backpressured.
    client.on('error', onConnectionError);
    if (signal.aborted) {
      destroy();
      throw interrupted();
    }
    signal.addEventListener('abort', destroy, { once: true });
    transaction = true;
    await run('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await run("SET LOCAL statement_timeout = '5s'");
    await run("SET LOCAL idle_in_transaction_session_timeout = '10s'");
    await run("SET LOCAL TIME ZONE 'UTC'");
    for (const source of ACCOUNT_ARCHIVE_SOURCES) {
      // All identifiers/projections are source constants, never supplied by a request.
      await run(
        `DECLARE account_archive_cursor NO SCROLL CURSOR FOR
        SELECT CASE WHEN octet_length(row_to_json(export_row)::text) <= ${ACCOUNT_ARCHIVE_LIMITS.recordBytes}
          THEN row_to_json(export_row)::text ELSE NULL END AS payload
        FROM (SELECT ${source.columns} FROM public.${source.table}
          WHERE ${source.owner} = $1 ORDER BY id) AS export_row`,
        [userId]
      );
      let firstPage = true;
      while (true) {
        const page = await run(
          `FETCH FORWARD ${ACCOUNT_ARCHIVE_LIMITS.fetchRows} FROM account_archive_cursor`
        );
        if (firstPage && source.section === 'profile') {
          if (!page.rows.length) throw AppError.notFound('User not found');
          yield encode({
            type: 'manifest',
            format: 'lifestyle-domain-archive',
            version: 1,
            exportedAt: new Date().toISOString(),
            snapshot: 'repeatable-read',
            sections: ACCOUNT_ARCHIVE_SOURCES.map((s) => s.section),
            exclusions: ACCOUNT_ARCHIVE_EXCLUSIONS,
            includesSoftDeleted: true,
            numericEncoding: 'PostgreSQL numeric values are decimal strings',
            limits: ACCOUNT_ARCHIVE_LIMITS
          });
        }
        firstPage = false;
        for (const row of page.rows) {
          if (
            row.payload === null ||
            Buffer.byteLength(row.payload) > ACCOUNT_ARCHIVE_LIMITS.recordBytes
          ) {
            throw AppError.payloadTooLarge('A record exceeds the synchronous export limit');
          }
          const data: unknown = JSON.parse(row.payload);
          counts[source.section] = (counts[source.section] ?? 0) + 1;
          records++;
          yield encode({ type: 'record', section: source.section, data });
        }
        if (page.rows.length < ACCOUNT_ARCHIVE_LIMITS.fetchRows) break;
      }
      await run('CLOSE account_archive_cursor');
    }
    await run('COMMIT');
    transaction = false;
    return { counts, records, bytesBeforeComplete: bytes, sha256: hash.digest('hex') };
  } finally {
    try {
      if (client && !released && transaction) {
        try {
          await run('ROLLBACK');
        } catch {
          destroy();
        }
      }
    } finally {
      signal.removeEventListener('abort', destroy);
      if (client && !released) {
        released = true;
        client.release();
      }
      client?.removeListener('error', onConnectionError);
      activeUsers.delete(userId);
    }
  }
}
