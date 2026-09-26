/**
 * Password hashing behind an interface (spec sections 5 and 12).
 *
 * The interface exists so `AuthService` depends on the IDEA of hashing rather
 * than on bcrypt itself. Two concrete benefits, not just theory:
 *   - Unit tests inject a fake hasher and run in milliseconds instead of paying
 *     bcrypt's deliberate cost on every test user.
 *   - Migrating to argon2 later means adding one class, not editing the service.
 */
import bcrypt from 'bcrypt';

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
  /** True when `hash` was produced with outdated parameters and should be re-hashed. */
  needsRehash(hash: string): boolean;
}

/**
 * bcrypt implementation.
 *
 * Cost is configurable because the right value is a function of production CPU:
 * spec section 12 asks for it to be set from performance testing. 12 is a sane
 * default, roughly 250ms on a modern core, slow enough to make offline cracking
 * expensive and fast enough not to become a login bottleneck.
 *
 * bcrypt truncates input at 72 bytes. Passwords are therefore length-capped at
 * validation time, so a user cannot set a 200-character password of which only
 * the first 72 bytes are ever checked.
 */
export class BcryptPasswordHasher implements PasswordHasher {
  public static readonly MAX_PASSWORD_BYTES = 72;

  constructor(private readonly cost: number) {
    if (!Number.isInteger(cost) || cost < 10 || cost > 15) {
      throw new Error(`bcrypt cost must be an integer between 10 and 15, received ${cost}`);
    }
  }

  public async hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.cost);
  }

  /**
   * Verifies a password.
   *
   * Returns false rather than throwing when the stored hash is malformed. A
   * corrupt row must read as "wrong password", not as a 500 that tells an
   * attacker which accounts have damaged hashes.
   */
  public async verify(plain: string, hash: string): Promise<boolean> {
    try {
      return await bcrypt.compare(plain, hash);
    } catch {
      return false;
    }
  }

  public needsRehash(hash: string): boolean {
    try {
      return bcrypt.getRounds(hash) < this.cost;
    } catch {
      // Unparseable hash: treat as needing replacement.
      return true;
    }
  }
}

/**
 * A dummy hash used to equalize timing on the login path.
 *
 * When the email does not exist there is nothing to compare against, so the
 * handler would return immediately while a real account pays bcrypt's cost. That
 * difference is measurable and turns login into an account-enumeration oracle.
 * Verifying against this constant burns the same time (spec section 23).
 */
export const TIMING_EQUALIZER_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.7hHJ2v6vTCWO7z2Qz1H4gQ8nZ6XxYyO';
