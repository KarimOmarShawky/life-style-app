import { timingSafeEqual } from 'node:crypto';
import { inspect } from 'node:util';
import type { WalletOwnedRecordsTable } from '../../infrastructure/database/postgres/kysely.js';
import { WalletSessionStore } from './wallet-session-store.pg.js';
import { MAX_WALLET_RECORD_PLAINTEXT_BYTES, WalletRecordCipher } from './wallet-record-cipher.js';

type RecordKind = WalletOwnedRecordsTable['kind'];
type WriteOutcome = 'created' | 'replayed' | 'conflict';
const RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/;
const KINDS = new Set<RecordKind>(['candidate', 'review', 'transaction', 'quarantine']);

/** Serialized/inspected instances never include even the opaque envelope. */
export class WalletOwnedRecord {
  readonly #id: string;
  readonly #kind: RecordKind;
  readonly #envelope: Buffer;

  constructor(id: string, kind: RecordKind, envelope: Buffer) {
    this.#id = id;
    this.#kind = kind;
    this.#envelope = Buffer.from(envelope);
  }
  get id(): string {
    return this.#id;
  }
  get kind(): RecordKind {
    return this.#kind;
  }
  get envelope(): Buffer {
    return Buffer.from(this.#envelope);
  }
  toString(): string {
    return 'WalletOwnedRecord([redacted])';
  }
  toJSON(): string {
    return this.toString();
  }
  [inspect.custom](): string {
    return this.toString();
  }
}

/**
 * Unwired, append-only storage experiment. Tokens and record owners come from
 * the independent session store, not caller-provided owner IDs. This alone is
 * NOT SMS ownership: create() can issue unverified sessions and the caller can
 * supply arbitrary plaintext. Encryption occurs on the server; it is not
 * end-to-end encryption. Never wire to a route or use real data until an
 * authenticated capture authority, key lifecycle, provenance, consent,
 * database logging, recovery, retention and deletion are tested end to end.
 */
export class WalletOwnedRecordStore {
  readonly #sessions: WalletSessionStore;
  readonly #cipher: WalletRecordCipher;

  constructor(sessions: WalletSessionStore, cipher: WalletRecordCipher) {
    if (!(cipher instanceof WalletRecordCipher)) throw new Error('Wallet record cipher required');
    this.#sessions = sessions;
    this.#cipher = cipher;
  }

  toString(): string {
    return 'WalletOwnedRecordStore([redacted])';
  }
  toJSON(): string {
    return this.toString();
  }
  [inspect.custom](): string {
    return this.toString();
  }

  /** Identical bytes/kind replay safely; a changed envelope never overwrites. */
  async put(token: string, id: string, kind: RecordKind, envelope: Buffer) {
    if (
      !RECORD_ID.test(id) ||
      !KINDS.has(kind) ||
      !Buffer.isBuffer(envelope) ||
      envelope.length === 0 ||
      envelope.length > MAX_WALLET_RECORD_PLAINTEXT_BYTES
    ) {
      throw new Error('Invalid wallet record');
    }
    // Caller mutation while waiting for a session lock cannot change the write.
    const payload = Buffer.from(envelope);
    return this.#sessions.withActiveSession<WriteOutcome>(token, async (trx, identity) => {
      const sealed = this.#cipher.seal(identity.walletAccountId, id, kind, payload);
      const inserted = await trx
        .insertInto('wallet_owned_records')
        .values({
          wallet_account_id: identity.walletAccountId,
          id,
          kind,
          envelope: sealed
        })
        .onConflict((oc) => oc.columns(['wallet_account_id', 'id']).doNothing())
        .returning('id')
        .executeTakeFirst();
      if (inserted) return 'created';
      const existing = await trx
        .selectFrom('wallet_owned_records')
        .select(['kind', 'envelope'])
        .where('wallet_account_id', '=', identity.walletAccountId)
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      if (existing.kind !== kind) return 'conflict';
      const existingPayload = this.#cipher.open(
        identity.walletAccountId,
        id,
        kind,
        existing.envelope
      );
      if (existingPayload.length === payload.length && timingSafeEqual(existingPayload, payload)) {
        return 'replayed';
      }
      return 'conflict';
    });
  }

  /** A foreign/missing record is indistinguishable; only this wallet is queried. */
  async get(token: string, id: string) {
    if (!RECORD_ID.test(id)) throw new Error('Invalid wallet record');
    return this.#sessions.withActiveSession<WalletOwnedRecord | null>(
      token,
      async (trx, identity) => {
        const row = await trx
          .selectFrom('wallet_owned_records')
          .select(['id', 'kind', 'envelope'])
          .where('wallet_account_id', '=', identity.walletAccountId)
          .where('id', '=', id)
          .executeTakeFirst();
        if (!row) return null;
        const plaintext = this.#cipher.open(
          identity.walletAccountId,
          row.id,
          row.kind,
          row.envelope
        );
        return new WalletOwnedRecord(row.id, row.kind, plaintext);
      }
    );
  }
}
