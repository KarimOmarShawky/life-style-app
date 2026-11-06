import { randomBytes, randomUUID } from 'node:crypto';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  MAX_WALLET_RECORD_PLAINTEXT_BYTES,
  WalletRecordCipher
} from '../../src/features/wallet-auth/wallet-record-cipher.js';

// Synthetic buffers and in-memory test keys only; no real messages or key store.
describe('server-side wallet record cipher (unwired)', () => {
  it('requires a 32-byte key, copies it and redacts normal serialization', () => {
    expect(() => new WalletRecordCipher(Buffer.alloc(31))).toThrow('Invalid wallet record key');
    expect(() => new WalletRecordCipher(Buffer.alloc(33))).toThrow('Invalid wallet record key');
    const key = randomBytes(32);
    const keyCopy = Buffer.from(key);
    const cipher = new WalletRecordCipher(key);
    const owner = randomUUID();
    const id = randomUUID();
    const payload = Buffer.from('synthetic wallet content');
    const sealed = cipher.seal(owner, id, 'review', payload);
    key.fill(0);
    expect(cipher.open(owner, id, 'review', sealed).equals(payload)).toBe(true);
    expect(new WalletRecordCipher(keyCopy).open(owner, id, 'review', sealed).equals(payload)).toBe(
      true
    );
    expect(JSON.stringify(cipher)).not.toContain(keyCopy.toString('hex'));
    expect(inspect(cipher)).not.toContain(keyCopy.toString('hex'));
  });

  it('uses fresh nonces and binds the authenticated owner, item and kind', () => {
    const cipher = new WalletRecordCipher(randomBytes(32));
    const owner = randomUUID();
    const id = randomUUID();
    const payload = Buffer.from('synthetic wallet content');
    const one = cipher.seal(owner, id, 'candidate', payload);
    const two = cipher.seal(owner, id, 'candidate', payload);
    expect(one.equals(two)).toBe(false);
    expect(one.includes(payload)).toBe(false);
    expect(cipher.open(owner, id, 'candidate', one).equals(payload)).toBe(true);
    expect(() => cipher.open(randomUUID(), id, 'candidate', one)).toThrow(
      'Wallet record integrity failure'
    );
    expect(() => cipher.open(owner, randomUUID(), 'candidate', one)).toThrow(
      'Wallet record integrity failure'
    );
    expect(() => cipher.open(owner, id, 'review', one)).toThrow('Wallet record integrity failure');
    expect(() => new WalletRecordCipher(randomBytes(32)).open(owner, id, 'candidate', one)).toThrow(
      'Wallet record integrity failure'
    );
  });

  it('rejects altered, truncated, legacy and unknown-version envelopes without plaintext fallback', () => {
    const cipher = new WalletRecordCipher(randomBytes(32));
    const owner = randomUUID();
    const id = randomUUID();
    const sealed = cipher.seal(owner, id, 'quarantine', Buffer.from('synthetic'));
    for (const index of [0, 4, 16, sealed.length - 1]) {
      const changed = Buffer.from(sealed);
      changed[index] = changed[index]! ^ 1;
      expect(() => cipher.open(owner, id, 'quarantine', changed)).toThrow(
        'Wallet record integrity failure'
      );
    }
    for (const invalid of [
      Buffer.alloc(0),
      sealed.subarray(0, sealed.length - 1),
      Buffer.from('synthetic legacy plaintext'),
      Buffer.alloc(90001)
    ]) {
      expect(() => cipher.open(owner, id, 'quarantine', invalid)).toThrow(
        'Wallet record integrity failure'
      );
    }
  });

  it('bounds data and requires valid, canonical bindings', () => {
    const cipher = new WalletRecordCipher(randomBytes(32));
    const owner = randomUUID();
    const id = randomUUID();
    const max = Buffer.alloc(MAX_WALLET_RECORD_PLAINTEXT_BYTES, 7);
    const sealed = cipher.seal(owner, id, 'transaction', max);
    expect(sealed).toHaveLength(90000);
    expect(cipher.open(owner, id, 'transaction', sealed).equals(max)).toBe(true);
    expect(() => cipher.seal(owner, id, 'transaction', Buffer.alloc(0))).toThrow(
      'Invalid wallet record'
    );
    expect(() =>
      cipher.seal(owner, id, 'transaction', Buffer.alloc(MAX_WALLET_RECORD_PLAINTEXT_BYTES + 1))
    ).toThrow('Invalid wallet record');
    expect(() =>
      cipher.seal('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', id, 'transaction', Buffer.from('x'))
    ).toThrow('Invalid wallet record binding');
    expect(() => cipher.seal(owner, id + '\n', 'transaction', Buffer.from('x'))).toThrow(
      'Invalid wallet record binding'
    );
    expect(() => cipher.seal(owner, id, 'wrong' as never, Buffer.from('x'))).toThrow(
      'Invalid wallet record binding'
    );
  });
});
