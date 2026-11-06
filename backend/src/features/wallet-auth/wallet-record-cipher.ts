import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import type { WalletOwnedRecordsTable } from '../../infrastructure/database/postgres/kysely.js';

type RecordKind = WalletOwnedRecordsTable['kind'];
const MAGIC = Buffer.from('LWR1', 'ascii');
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const OVERHEAD = MAGIC.length + IV_LENGTH + TAG_LENGTH;
export const MAX_WALLET_RECORD_PLAINTEXT_BYTES = 90000 - OVERHEAD;
const OWNER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\s\S])/;
const ITEM = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/;
const KINDS = new Set<RecordKind>(['candidate', 'review', 'transaction', 'quarantine']);

function aad(owner: string, id: string, kind: RecordKind): Buffer {
  if (!OWNER.test(owner) || !ITEM.test(id) || !KINDS.has(kind)) {
    throw new Error('Invalid wallet record binding');
  }
  return Buffer.from(`lifestyle.wallet.server-record.v1\0${owner}\0${id}\0${kind}`, 'utf8');
}

/**
 * Unwired encryption building block; inject a dedicated random 32-byte key.
 * AAD binds ciphertext to the server-derived owner, item ID and kind. This is
 * server-side encryption, not end-to-end encryption or proof of SMS ownership.
 * Plaintext still exists in the caller and server memory; plaintext must not be
 * logged or sent to providers without separate policy and consent. Version 1
 * has no key ID/rotation, KMS, backup/recovery or nonce-volume accounting.
 * Do not use real data until those controls and database logging are reviewed.
 */
export class WalletRecordCipher {
  readonly #key: Buffer;

  constructor(key: Uint8Array) {
    if (!(key instanceof Uint8Array) || key.byteLength !== 32) {
      throw new Error('Invalid wallet record key');
    }
    this.#key = Buffer.from(key);
  }

  seal(owner: string, id: string, kind: RecordKind, plaintext: Buffer): Buffer {
    if (
      !Buffer.isBuffer(plaintext) ||
      plaintext.length === 0 ||
      plaintext.length > MAX_WALLET_RECORD_PLAINTEXT_BYTES
    ) {
      throw new Error('Invalid wallet record');
    }
    const binding = aad(owner, id, kind);
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    cipher.setAAD(binding);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
  }

  /** Unrecognized, damaged or wrongly bound data is never returned as plaintext. */
  open(owner: string, id: string, kind: RecordKind, sealed: Buffer): Buffer {
    const binding = aad(owner, id, kind);
    if (
      !Buffer.isBuffer(sealed) ||
      sealed.length <= OVERHEAD ||
      sealed.length > 90000 ||
      !sealed.subarray(0, MAGIC.length).equals(MAGIC)
    ) {
      throw new Error('Wallet record integrity failure');
    }
    try {
      const iv = sealed.subarray(MAGIC.length, MAGIC.length + IV_LENGTH);
      const tag = sealed.subarray(MAGIC.length + IV_LENGTH, OVERHEAD);
      const ciphertext = sealed.subarray(OVERHEAD);
      const cipher = createDecipheriv('aes-256-gcm', this.#key, iv);
      cipher.setAAD(binding);
      cipher.setAuthTag(tag);
      return Buffer.concat([cipher.update(ciphertext), cipher.final()]);
    } catch {
      throw new Error('Wallet record integrity failure');
    }
  }

  toString(): string {
    return 'WalletRecordCipher([redacted])';
  }
  toJSON(): string {
    return this.toString();
  }
  [inspect.custom](): string {
    return this.toString();
  }
}
