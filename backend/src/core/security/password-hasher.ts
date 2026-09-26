/**
 * src/core/security/password-hasher.ts
 *
 * Implements Section 8.4: Password policy and secure bcrypt hashing.
 * Includes dummy comparison for timing attack mitigation on unknown user logins.
 */

import bcrypt from 'bcrypt';
import { getEnv } from '../../config/env.js';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
  dummyVerify(): Promise<boolean>;
}

// Fixed dummy hash used to equalize timing when an email is not found
const DUMMY_HASH = '$2b$12$e80yq9jG6XpXl8x3Q5u8Me7m9wE6.Vv7Q.3c6g5a9e3b1c9d8e7f0';

export class BcryptPasswordHasher implements PasswordHasher {
  private readonly rounds: number;

  constructor(rounds?: number) {
    this.rounds = rounds ?? getEnv().BCRYPT_COST;
  }

  public async hash(password: string): Promise<string> {
    return bcrypt.hash(password, this.rounds);
  }

  public async verify(password: string, hash: string): Promise<boolean> {
    try {
      return await bcrypt.compare(password, hash);
    } catch {
      return false;
    }
  }

  public async dummyVerify(): Promise<boolean> {
    try {
      await bcrypt.compare('dummy-password-for-timing-similarity', DUMMY_HASH);
    } catch {
      // Ignored
    }
    return false;
  }
}
