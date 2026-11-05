import { randomBytes, randomUUID } from 'node:crypto';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { hashIngestToken, isIngestTokenFormat } from '../../src/core/security/ingest-token.js';
import { JoseTokenService } from '../../src/core/security/token-service.js';
import {
  createWalletSessionToken,
  hashWalletSessionToken,
  isWalletSessionToken,
  normalizeWalletPhone,
  walletPhoneLookup,
  walletPhoneOtpDigest,
  walletPhoneOtpMatches
} from '../../src/features/wallet-auth/wallet-phone-security.js';

const phone = '+201012345678'; // Synthetic only; never deliver an SMS from these tests.
const lookupSecret = randomBytes(32);
const otpSecret = randomBytes(32);

describe('independent wallet phone identity primitives (not an authentication flow)', () => {
  it('accepts only unambiguous canonical international numeric form', () => {
    expect(normalizeWalletPhone(phone)).toBe(phone);
    for (const invalid of [
      '',
      '201012345678',
      '01012345678',
      ' +201012345678',
      '+2010 12345678',
      '+20-1012345678',
      '+0201012345678',
      '+2',
      '+1234567890123456',
      '+٢٠١٠١٢٣٤٥٦٧٨',
      '+201012345678\n',
      'tel:+201012345678'
    ]) {
      expect(normalizeWalletPhone(invalid)).toBeNull();
    }
  });

  it('creates deterministic keyed, domain-separated lookup digests without storing the number', () => {
    const first = walletPhoneLookup(lookupSecret, phone);
    expect(first).toHaveLength(32);
    expect(first.equals(walletPhoneLookup(lookupSecret, phone))).toBe(true);
    expect(first.equals(walletPhoneLookup(randomBytes(32), phone))).toBe(false);
    expect(first.equals(walletPhoneLookup(lookupSecret, '+201012345679'))).toBe(false);
    expect(first.includes(Buffer.from(phone))).toBe(false);
    expect(() => walletPhoneLookup(lookupSecret, '01012345678')).toThrow('Invalid wallet phone');
    expect(() => walletPhoneLookup(Buffer.alloc(31), phone)).toThrow('Invalid wallet secret');
  });

  it('binds a challenge digest to phone, challenge and code', () => {
    const challenge = randomUUID();
    const otherChallenge = randomUUID();
    const lookup = walletPhoneLookup(lookupSecret, phone);
    const otherLookup = walletPhoneLookup(lookupSecret, '+201012345679');
    const digest = walletPhoneOtpDigest(otpSecret, lookup, challenge, '004321');
    expect(walletPhoneOtpMatches(otpSecret, lookup, challenge, '004321', digest)).toBe(true);
    for (const [otherPhone, otherId, code] of [
      [otherLookup, challenge, '004321'],
      [lookup, otherChallenge, '004321'],
      [lookup, challenge, '004322'],
      [lookup, challenge, '4321']
    ] as const) {
      expect(walletPhoneOtpMatches(otpSecret, otherPhone, otherId, code, digest)).toBe(false);
    }
    expect(walletPhoneOtpMatches(otpSecret, lookup, challenge, '004321', Buffer.alloc(2))).toBe(
      false
    );
    expect(() => walletPhoneOtpDigest(otpSecret, lookup, challenge, 'not-code')).toThrow();
    expect(() => walletPhoneOtpDigest(otpSecret, lookup, 'not-uuid', '004321')).toThrow();
    expect(() => walletPhoneOtpDigest(otpSecret, Buffer.alloc(1), challenge, '004321')).toThrow();
    expect(() => walletPhoneOtpDigest(Buffer.alloc(31), lookup, challenge, '004321')).toThrow();
  });

  it('cannot authenticate a wallet token as an existing app access token', async () => {
    const token = createWalletSessionToken();
    await expect(new JoseTokenService().verifyAccessToken(token.token)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED'
    });
  });

  it('generates independent wallet-only opaque session tokens with canonical encoding', () => {
    const first = createWalletSessionToken();
    const second = createWalletSessionToken();
    expect(isWalletSessionToken(first.token)).toBe(true);
    expect(isIngestTokenFormat(first.token)).toBe(false);
    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).toHaveLength(32);
    expect(first.tokenHash.equals(hashWalletSessionToken(first.token)!)).toBe(true);
    expect(first.tokenHash.equals(hashIngestToken(first.token))).toBe(false);
    expect(JSON.stringify(first)).not.toContain(first.token);
    expect(inspect(first)).not.toContain(first.token);
    const exposedHash = first.tokenHash;
    exposedHash.fill(0);
    expect(first.tokenHash.equals(hashWalletSessionToken(first.token)!)).toBe(true);
    for (const invalid of [
      '',
      first.token.slice(0, -1),
      first.token + '=',
      first.token.replace('lwp_', 'lsi_'),
      first.token + '\n'
    ]) {
      expect(isWalletSessionToken(invalid)).toBe(false);
      expect(hashWalletSessionToken(invalid)).toBeNull();
    }
    // The final Base64url character can contain only two significant bits.
    const nonCanonical = first.token.slice(0, -1) + 'B';
    expect(isWalletSessionToken(nonCanonical)).toBe(false);
  });
});
