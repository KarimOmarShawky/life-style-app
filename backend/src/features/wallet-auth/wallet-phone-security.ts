import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { inspect } from 'node:util';

/**
 * Unwired primitives for a future, independent wallet phone identity.
 * These do not verify a phone, send an SMS, impose attempt limits, establish
 * an account or prove that a wallet/bank SMS belongs to this phone.
 */
const PHONE = /^\+[1-9][0-9]{1,14}(?![\s\S])/;
const CHALLENGE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/;
const CODE = /^[0-9]{6}(?![\s\S])/;
const TOKEN = /^lwp_[A-Za-z0-9_-]{43}(?![\s\S])/;
const LOOKUP_DOMAIN = 'lifestyle.wallet.phone.lookup.v1\0';
const OTP_DOMAIN = 'lifestyle.wallet.phone.challenge.v1\0';
const TOKEN_DOMAIN = 'lifestyle.wallet.phone.session.v1\0';

/** Structural E.164 only: this does not verify assignment or control of a number. */
export function normalizeWalletPhone(raw: string): string | null {
  return PHONE.test(raw) ? raw : null;
}

function requireSecret(secret: Uint8Array): void {
  // Length alone cannot prove entropy; deployment must provision random keys.
  if (secret.byteLength < 32) throw new Error('Invalid wallet secret');
}

/** Use a dedicated high-entropy server key; do not log the phone or digest. */
export function walletPhoneLookup(secret: Uint8Array, raw: string): Buffer {
  requireSecret(secret);
  const phone = normalizeWalletPhone(raw);
  if (phone === null) throw new Error('Invalid wallet phone');
  return createHmac('sha256', secret).update(LOOKUP_DOMAIN).update(phone).digest();
}

/**
 * OTP digest for storage in a future atomic one-use challenge store. This
 * primitive does NOT enforce TTL, retry budgets, delivery, or consumption.
 */
export function walletPhoneOtpDigest(
  secret: Uint8Array,
  lookup: Buffer,
  challengeId: string,
  code: string
): Buffer {
  requireSecret(secret);
  if (lookup.length !== 32 || !CHALLENGE.test(challengeId) || !CODE.test(code)) {
    throw new Error('Invalid wallet challenge');
  }
  return createHmac('sha256', secret)
    .update(OTP_DOMAIN)
    .update(lookup)
    .update(challengeId)
    .update(code)
    .digest();
}

export function walletPhoneOtpMatches(
  secret: Uint8Array,
  lookup: Buffer,
  challengeId: string,
  code: string,
  storedDigest: Buffer
): boolean {
  if (storedDigest.length !== 32) return false;
  try {
    const digest = walletPhoneOtpDigest(secret, lookup, challengeId, code);
    return timingSafeEqual(digest, storedDigest);
  } catch {
    return false;
  }
}

/** A future wallet credential, never a general app or legacy ingest credential. */
export function isWalletSessionToken(token: string): boolean {
  if (!TOKEN.test(token)) return false;
  const encoded = token.slice(4);
  const decoded = Buffer.from(encoded, 'base64url');
  return decoded.length === 32 && decoded.toString('base64url') === encoded;
}

export function hashWalletSessionToken(token: string): Buffer | null {
  if (!isWalletSessionToken(token)) return null;
  return createHash('sha256').update(TOKEN_DOMAIN).update(token).digest();
}

export class IssuedWalletSessionToken {
  readonly #token: string;
  readonly #hash: Buffer;

  private constructor(token: string, tokenHash: Buffer) {
    this.#token = token;
    this.#hash = Buffer.from(tokenHash);
  }

  static create(): IssuedWalletSessionToken {
    const token = `lwp_${randomBytes(32).toString('base64url')}`;
    const tokenHash = hashWalletSessionToken(token);
    if (tokenHash === null) throw new Error('Wallet token generation failed');
    return new IssuedWalletSessionToken(token, tokenHash);
  }

  get token(): string {
    return this.#token;
  }

  get tokenHash(): Buffer {
    return Buffer.from(this.#hash);
  }

  toString(): string {
    return 'IssuedWalletSessionToken([redacted])';
  }

  toJSON(): string {
    return this.toString();
  }

  [inspect.custom](): string {
    return this.toString();
  }
}

export function createWalletSessionToken(): IssuedWalletSessionToken {
  return IssuedWalletSessionToken.create();
}
