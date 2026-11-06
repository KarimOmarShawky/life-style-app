import { inspect } from 'node:util';
import type { WalletPhoneOtpStore } from './wallet-phone-otp-store.js';

/** Only an approved SMS adapter may read these fields. Never log or persist them. */
export class WalletOtpDeliveryRequest {
  readonly #phone: string;
  readonly #code: string;
  constructor(phone: string, code: string) {
    this.#phone = phone;
    this.#code = code;
  }
  get phone(): string {
    return this.#phone;
  }
  get code(): string {
    return this.#code;
  }
  toString(): string {
    return 'WalletOtpDeliveryRequest([redacted])';
  }
  toJSON(): string {
    return this.toString();
  }
  [inspect.custom](): string {
    return this.toString();
  }
}

/**
 * Promise resolution means only that the provider accepted the request; it is
 * not proof of delivery. An adapter has explicit access to phone/code and its
 * own logs, subcontractors, message contents, network and privacy policy must
 * be reviewed separately. No real provider is configured here.
 */
export interface WalletOtpDeliveryProvider {
  send(request: WalletOtpDeliveryRequest): Promise<void>;
}

type DeliveryResult = { accepted: false } | { accepted: true; challengeId: string };

/**
 * Unwired delivery orchestration, not a login endpoint. Redis OTP consumption
 * and durable session issuance are not atomic; no phone/account binding exists.
 * A provider request already started cannot be recalled, and it can deliver an
 * expired/superseded code. Redis timeout/failure may prevent invalidation; no
 * guarantee of cleanup is claimed. Global/IP/device rate limits, provider
 * approval, costs, anti-enumeration, durable Redis and recovery are still needed.
 */
export class WalletPhoneOtpDelivery {
  readonly #store: WalletPhoneOtpStore;
  readonly #provider: WalletOtpDeliveryProvider;

  constructor(store: WalletPhoneOtpStore, provider: WalletOtpDeliveryProvider) {
    if (!provider || typeof provider.send !== 'function')
      throw new Error('Wallet OTP provider required');
    this.#store = store;
    this.#provider = provider;
  }

  /**
   * On provider acceptance, return a challenge ID only if that exact challenge
   * is still current and has >30 seconds left. This status is a point-in-time
   * check: replacement, expiration and provider delivery can still occur later.
   * A refused budget does not call the provider. No phone, code, provider
   * errors or digests are returned or logged. No automatic retry is performed.
   */
  async request(phone: string): Promise<DeliveryResult> {
    let challenge;
    try {
      challenge = await this.#store.issue(phone);
    } catch {
      throw new Error('Wallet verification unavailable');
    }
    if (!challenge) return { accepted: false };

    try {
      await this.#provider.send(new WalletOtpDeliveryRequest(phone, challenge.code));
      if (!(await this.#store.isCurrent(phone, challenge))) throw new Error('Challenge stale');
      return { accepted: true, challengeId: challenge.id };
    } catch {
      // Do not destroy a replacement challenge or clear anti-abuse budgets.
      // Failure/timeouts here leave status uncertain; do not claim invalidation.
      try {
        await this.#store.invalidate(phone, challenge);
      } catch {
        // No provider/Redis error details or sensitive values reach callers.
      }
      throw new Error('Wallet verification unavailable');
    }
  }

  toString(): string {
    return 'WalletPhoneOtpDelivery([redacted])';
  }
  toJSON(): string {
    return this.toString();
  }
  [inspect.custom](): string {
    return this.toString();
  }
}
