/**
 * Unit tests for password hashing (spec sections 12 and 41).
 *
 * Cost 10 is used throughout: it is the lowest the constructor accepts, and
 * these tests hash repeatedly. At cost 12 the same suite would take minutes.
 */
import { describe, expect, it } from 'vitest';

import { BcryptPasswordHasher, TIMING_EQUALIZER_HASH } from '@/core/security/password-hasher';

const hasher = new BcryptPasswordHasher(10);

describe('BcryptPasswordHasher', () => {
  it('never stores the plaintext password', async () => {
    const password = 'CorrectHorse9Battery';
    const hash = await hasher.hash(password);

    expect(hash).not.toContain(password);
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(hash).toHaveLength(60);
  });

  it('produces a different hash each time for the same password', async () => {
    // Distinct salts. Identical hashes would let an attacker spot shared
    // passwords across accounts straight from a database dump.
    const a = await hasher.hash('CorrectHorse9Battery');
    const b = await hasher.hash('CorrectHorse9Battery');
    expect(a).not.toBe(b);
  });

  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hasher.hash('CorrectHorse9Battery');
    await expect(hasher.verify('CorrectHorse9Battery', hash)).resolves.toBe(true);
    await expect(hasher.verify('CorrectHorse9Batterx', hash)).resolves.toBe(false);
  });

  it('returns false rather than throwing on a malformed stored hash', async () => {
    // A corrupt row must read as "wrong password", not as a 500 that reveals
    // which accounts have damaged hashes.
    await expect(hasher.verify('anything', 'not-a-bcrypt-hash')).resolves.toBe(false);
    await expect(hasher.verify('anything', '')).resolves.toBe(false);
  });

  it('flags hashes weaker than the configured cost for rehashing', async () => {
    const weak = await new BcryptPasswordHasher(10).hash('CorrectHorse9Battery');
    expect(new BcryptPasswordHasher(12).needsRehash(weak)).toBe(true);
    expect(new BcryptPasswordHasher(10).needsRehash(weak)).toBe(false);
  });

  it('rejects a cost outside the safe range at construction', () => {
    expect(() => new BcryptPasswordHasher(4)).toThrow(/between 10 and 15/);
    expect(() => new BcryptPasswordHasher(20)).toThrow(/between 10 and 15/);
  });

  it('ships a timing-equalizer hash that is real and matches production cost', async () => {
    // If this constant were malformed, verify() would catch and return
    // immediately, and the unknown-email login path would be fast enough to act
    // as an account-enumeration oracle. This test is what keeps that honest.
    const started = Date.now();
    await expect(hasher.verify('anything', TIMING_EQUALIZER_HASH)).resolves.toBe(false);
    const elapsed = Date.now() - started;

    expect(TIMING_EQUALIZER_HASH).toMatch(/^\$2[aby]\$12\$/);
    expect(elapsed).toBeGreaterThan(20);
  });
});
