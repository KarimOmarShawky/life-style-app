import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { inspect } from 'node:util';
import type { Redis } from 'ioredis';
import {
  walletPhoneLookup,
  walletPhoneOtpDigest,
  walletPhoneOtpMatches
} from './wallet-phone-security.js';

// This store is deliberately unwired. It is not a phone login endpoint or SMS
// delivery adapter and does not create wallet identities or sessions.
const CHALLENGE_TTL_SECONDS = 300;
const COOLDOWN_SECONDS = 60;
const WINDOW_SECONDS = 3600;
const MAX_ISSUANCES = 5;
const MAX_CHALLENGE_ATTEMPTS = 5;
const MAX_PHONE_ATTEMPTS = 20;

// All keys use a single per-phone Redis Cluster hash tag. A replacement resets
// only its per-code attempts; issuance and cross-code budgets remain intact.
const ISSUE_SCRIPT = `-- wallet-phone-otp-issue-v1
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
local issued = tonumber(redis.call('GET', KEYS[3]) or '0')
if issued >= tonumber(ARGV[4]) then return 0 end
issued = redis.call('INCR', KEYS[3])
if issued == 1 or redis.call('TTL', KEYS[3]) < 0 then redis.call('EXPIRE', KEYS[3], tonumber(ARGV[3])) end
redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[2]))
redis.call('SET', KEYS[2], '1', 'EX', tonumber(ARGV[5]))
redis.call('DEL', KEYS[4])
return 1
`;

// A delayed verifier cannot consume or spend attempts against a replacement.
// Attempts, both budgets and successful consumption are one Redis operation.
const VERIFY_SCRIPT = `-- wallet-phone-otp-verify-v1
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
-- A restored or malformed key without expiry must never become a perpetual OTP.
if redis.call('PTTL', KEYS[1]) <= 0 then
  redis.call('DEL', KEYS[1], KEYS[2])
  return 0
end
local total = redis.call('INCR', KEYS[3])
if total == 1 or redis.call('TTL', KEYS[3]) < 0 then redis.call('EXPIRE', KEYS[3], tonumber(ARGV[5])) end
if total > tonumber(ARGV[4]) then
  redis.call('DEL', KEYS[1], KEYS[2])
  return 0
end
local attempts = redis.call('INCR', KEYS[2])
if attempts == 1 or redis.call('PTTL', KEYS[2]) < 0 then
  local ttl = redis.call('PTTL', KEYS[1])
  redis.call('PEXPIRE', KEYS[2], ttl > 0 and ttl or 1)
end
if attempts > tonumber(ARGV[3]) then
  redis.call('DEL', KEYS[1], KEYS[2])
  return 0
end
if ARGV[2] == '1' then
  redis.call('DEL', KEYS[1], KEYS[2])
  return 1
end
if attempts >= tonumber(ARGV[3]) then redis.call('DEL', KEYS[1], KEYS[2]) end
return 0
`;

// The provider result can be delayed beyond replacement or expiration. These
// operations compare the entire original snapshot and never affect a newer
// challenge. Cooldown/issuance and phone-attempt budgets are deliberately kept.
const CURRENT_SCRIPT = `-- wallet-phone-otp-current-v1
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
if redis.call('PTTL', KEYS[1]) <= 30000 then return 0 end
return 1
`;
const INVALIDATE_SCRIPT = `-- wallet-phone-otp-invalidate-v1
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1], KEYS[2])
return 1
`;

export interface IssuedWalletPhoneChallenge {
  readonly id: string;
  /** The caller must deliver this only through an approved provider, never log it. */
  readonly code: string;
}

class RedactedChallenge implements IssuedWalletPhoneChallenge {
  readonly #id: string;
  readonly #code: string;
  constructor(id: string, code: string) {
    this.#id = id;
    this.#code = code;
  }
  get id(): string {
    return this.#id;
  }
  get code(): string {
    return this.#code;
  }
  toString(): string {
    return 'IssuedWalletPhoneChallenge([redacted])';
  }
  toJSON(): string {
    return this.toString();
  }
  [inspect.custom](): string {
    return this.toString();
  }
}

interface Keys {
  current: string;
  cooldown: string;
  issued: string;
  attempts: string;
  phoneAttempts: string;
}

export class WalletPhoneOtpStore {
  readonly #redis: Redis;
  readonly #lookupSecret: Buffer;
  readonly #otpSecret: Buffer;

  constructor(redis: Redis, lookupSecret: Uint8Array, otpSecret: Uint8Array) {
    if (lookupSecret.byteLength < 32 || otpSecret.byteLength < 32)
      throw new Error('Invalid wallet secret');
    if (
      lookupSecret.byteLength === otpSecret.byteLength &&
      timingSafeEqual(lookupSecret, otpSecret)
    ) {
      throw new Error('Wallet secrets must be distinct');
    }
    // Callers cannot change these keys by mutating the supplied arrays later.
    this.#redis = redis;
    this.#lookupSecret = Buffer.from(lookupSecret);
    this.#otpSecret = Buffer.from(otpSecret);
  }

  toString(): string {
    return 'WalletPhoneOtpStore([redacted])';
  }

  toJSON(): string {
    return this.toString();
  }

  [inspect.custom](): string {
    return this.toString();
  }

  private keys(lookup: Buffer): Keys {
    const prefix = `wallet:phone:otp:{${lookup.toString('hex')}}:`;
    return {
      current: `${prefix}current`,
      cooldown: `${prefix}cooldown`,
      issued: `${prefix}issued`,
      attempts: `${prefix}attempts`,
      phoneAttempts: `${prefix}phone-attempts`
    };
  }

  /** Returns null for a bounded refusal; Redis errors propagate rather than fail open. */
  async issue(phone: string): Promise<IssuedWalletPhoneChallenge | null> {
    const lookup = walletPhoneLookup(this.#lookupSecret, phone);
    const key = this.keys(lookup);
    const id = randomUUID();
    const code = randomInt(1_000_000).toString().padStart(6, '0');
    const digest = walletPhoneOtpDigest(this.#otpSecret, lookup, id, code).toString('hex');
    const snapshot = `${id}:${digest}`;
    const result = await this.#redis.eval(
      ISSUE_SCRIPT,
      4,
      key.current,
      key.cooldown,
      key.issued,
      key.attempts,
      snapshot,
      CHALLENGE_TTL_SECONDS,
      WINDOW_SECONDS,
      MAX_ISSUANCES,
      COOLDOWN_SECONDS
    );
    if (result === 0) return null;
    if (result !== 1) throw new Error('Wallet challenge issue failed');
    return new RedactedChallenge(id, code);
  }

  /** Check only the original challenge, requiring over 30 seconds remaining. */
  async isCurrent(phone: string, challenge: IssuedWalletPhoneChallenge): Promise<boolean> {
    const lookup = walletPhoneLookup(this.#lookupSecret, phone);
    const keys = this.keys(lookup);
    const digest = walletPhoneOtpDigest(this.#otpSecret, lookup, challenge.id, challenge.code);
    const result = await this.#redis.eval(
      CURRENT_SCRIPT,
      1,
      keys.current,
      `${challenge.id}:${digest.toString('hex')}`
    );
    if (result !== 0 && result !== 1) throw new Error('Wallet challenge status failed');
    return result === 1;
  }

  /** Best-effort invalidation; false means already expired, consumed or replaced. */
  async invalidate(phone: string, challenge: IssuedWalletPhoneChallenge): Promise<boolean> {
    const lookup = walletPhoneLookup(this.#lookupSecret, phone);
    const keys = this.keys(lookup);
    const digest = walletPhoneOtpDigest(this.#otpSecret, lookup, challenge.id, challenge.code);
    const result = await this.#redis.eval(
      INVALIDATE_SCRIPT,
      2,
      keys.current,
      keys.attempts,
      `${challenge.id}:${digest.toString('hex')}`
    );
    if (result !== 0 && result !== 1) throw new Error('Wallet challenge invalidation failed');
    return result === 1;
  }

  /** Consume at most once. Additional IP/device limits and delivery controls are required. */
  async verify(phone: string, challengeId: string, code: string): Promise<boolean> {
    const lookup = walletPhoneLookup(this.#lookupSecret, phone);
    const key = this.keys(lookup);
    const snapshot = await this.#redis.get(key.current);
    if (snapshot === null) return false;
    const match = /^([0-9a-f-]{36}):([0-9a-f]{64})(?![\s\S])/.exec(snapshot);
    if (!match || match[1] !== challengeId || !match[2]) return false;
    const correct = walletPhoneOtpMatches(
      this.#otpSecret,
      lookup,
      challengeId,
      code,
      Buffer.from(match[2], 'hex')
    );
    const result = await this.#redis.eval(
      VERIFY_SCRIPT,
      3,
      key.current,
      key.attempts,
      key.phoneAttempts,
      snapshot,
      correct ? '1' : '0',
      MAX_CHALLENGE_ATTEMPTS,
      MAX_PHONE_ATTEMPTS,
      WINDOW_SECONDS
    );
    if (result !== 0 && result !== 1) throw new Error('Wallet challenge verification failed');
    return result === 1;
  }
}
