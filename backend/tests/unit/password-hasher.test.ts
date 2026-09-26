/**
 * tests/unit/password-hasher.test.ts
 *
 * Validates Section 8.4: Bcrypt password hasher and dummy verify behavior.
 */

import { describe, it, expect } from 'vitest';
import { BcryptPasswordHasher } from '../../src/core/security/password-hasher.js';

describe('BcryptPasswordHasher', () => {
  // Use lower rounds in unit tests for speed
  const hasher = new BcryptPasswordHasher(4);

  it('hashes a password and verifies correctly', async () => {
    const plain = 'SecurePassword123!';
    const hash = await hasher.hash(plain);

    expect(hash).toMatch(/^\$2[ab]\$\d+\$/);
    expect(await hasher.verify(plain, hash)).toBe(true);
    expect(await hasher.verify('WrongPassword', hash)).toBe(false);
  });

  it('dummyVerify returns false and completes without throwing', async () => {
    const result = await hasher.dummyVerify();
    expect(result).toBe(false);
  });
});
