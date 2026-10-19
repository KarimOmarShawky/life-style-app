import { describe, it, expect } from 'vitest';
import { UuidGenerator } from '../../src/core/security/id-generator.js';

describe('UuidGenerator', () => {
  const generator = new UuidGenerator();

  it('generates UUIDv4-shaped identifiers', () => {
    const id = generator.generateId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(generator.generateId()).not.toBe(id);
  });

  it('generates opaque hex tokens with the requested byte length', () => {
    const token = generator.generateOpaqueToken(16);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(generator.generateOpaqueToken()).toHaveLength(64);
    expect(generator.generateOpaqueToken()).not.toBe(token);
  });
});
