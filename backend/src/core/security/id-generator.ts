/**
 * src/core/security/id-generator.ts
 *
 * Implements Section 4.4 & ADR-008: ID and Opaque Token Generation.
 * Provides non-enumerable UUIDv4 primary keys and cryptographically secure random values.
 */

import { randomUUID, randomBytes } from 'node:crypto';

export interface IdGenerator {
  generateId(): string;
  generateOpaqueToken(byteLength?: number): string;
}

export class UuidGenerator implements IdGenerator {
  public generateId(): string {
    return randomUUID();
  }

  public generateOpaqueToken(byteLength = 32): string {
    return randomBytes(byteLength).toString('hex');
  }
}
