import { sql, type Kysely, type Transaction } from 'kysely';
import type { DatabaseSchema } from '../../infrastructure/database/postgres/kysely.js';
import {
  createWalletSessionToken,
  hashWalletSessionToken,
  type IssuedWalletSessionToken
} from './wallet-phone-security.js';

export interface WalletSessionIdentity {
  readonly walletAccountId: string;
  readonly sessionId: string;
}

type SessionResult<T> = { authenticated: false } | { authenticated: true; value: T };

/**
 * Unwired storage primitives, NOT a login service. In particular, create()
 * proves no phone control and does not bind OTP consumption to issuance. Do
 * not expose it in a route or associate it with any actual financial data until
 * verification, durable issuance, account recovery, and capture ownership have
 * been designed and tested together. No phone numbers or SMS are stored here.
 */
export class WalletSessionStore {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  /** Create a fresh, unbound principal and a one-day token in one DB transaction. */
  async create(): Promise<WalletSessionIdentity & { credential: IssuedWalletSessionToken }> {
    const credential = createWalletSessionToken();
    return this.db.transaction().execute(async (trx) => {
      const account = await trx
        .insertInto('wallet_accounts')
        .defaultValues()
        .returning('id')
        .executeTakeFirstOrThrow();
      const session = await trx
        .insertInto('wallet_account_sessions')
        .values({
          wallet_account_id: account.id,
          token_hash: credential.tokenHash,
          expires_at: sql<Date>`clock_timestamp() + interval '1 day'`,
          revoked_at: null
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { walletAccountId: account.id, sessionId: session.id, credential };
    });
  }

  /**
   * Serialize a DB-only operation with revocation. The callback runs inside the
   * transaction while its session row is locked; it must not do network I/O,
   * retain the transaction, disclose data outside the transaction, or start
   * work that can outlive it. Callers must use the server-derived wallet ID,
   * not an owner supplied by the client. This fence alone does not establish
   * message ownership and does not recall work already delivered elsewhere.
   */
  async withActiveSession<T>(
    token: string,
    operation: (trx: Transaction<DatabaseSchema>, identity: WalletSessionIdentity) => Promise<T>
  ): Promise<SessionResult<T>> {
    const hash = hashWalletSessionToken(token);
    if (hash === null) return { authenticated: false };
    return this.db.transaction().execute(async (trx) => {
      const session = await trx
        .selectFrom('wallet_account_sessions')
        .select(['id', 'wallet_account_id'])
        .where('token_hash', '=', hash)
        .forUpdate()
        .executeTakeFirst();
      if (!session) return { authenticated: false };

      // PostgreSQL now() is fixed at transaction start: a lock waiter could
      // otherwise accept a credential that expired while waiting for the lock.
      const active = await trx
        .selectFrom('wallet_account_sessions')
        .select('id')
        .where('id', '=', session.id)
        .where('revoked_at', 'is', null)
        .where('expires_at', '>', sql<Date>`clock_timestamp()`)
        .executeTakeFirst();
      if (!active) return { authenticated: false };
      const value = await operation(trx, {
        walletAccountId: session.wallet_account_id,
        sessionId: session.id
      });
      return { authenticated: true, value };
    });
  }

  /** Revoke only the presented wallet token. A stale or malformed token is a no-op. */
  async revoke(token: string): Promise<boolean> {
    const hash = hashWalletSessionToken(token);
    if (hash === null) return false;
    const result = await this.db
      .updateTable('wallet_account_sessions')
      .set({ revoked_at: sql<Date>`clock_timestamp()` })
      .where('token_hash', '=', hash)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    return result.numUpdatedRows === 1n;
  }
}
