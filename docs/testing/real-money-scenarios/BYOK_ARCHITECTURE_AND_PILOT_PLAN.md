# BYOK Architecture and Pilot Plan

> Audit-era design document (2026-10-10). The pilot pass that originally accompanied
> this document is no longer runnable against a synthetic database; this document
> preserves the architecture decisions and the pilot design.

## 1. What "BYOK" Means Here

BYOK in this product means an **independent provider account and key on the user's side**.
It is NOT a shared key, NOT a prepaid balance inside the app, and NOT a redistribution
of the app's own quota. The user pays their provider directly (Google AI Studio /
Gemini), and the app uses their key on their behalf.

## 2. Per-Request Isolation (IAM Discipline)

- One provider account == one key. The user creates it in the provider's console.
- The key is presented per request and never mixed with other users' traffic.
- One user's quota exhaustion, rate limit, or billing problem must never affect
  another user. There is no shared key pool and no key rotation across users.

## 3. Gemini-Only Provider

The pilot supports Google Gemini only (the provider already integrated for wallet
SMS fallback and the AI assistant). OpenAI/Anthropic are out of scope for the pilot;
multi-provider abstraction is deferred until a real second provider exists.

## 4. Configuration & Staging

- **Dev/test override**: `env.GEMINI_API_KEY` continues to work as a local override
  so development and CI never depend on a user-provided key.
- **Staging**: the project's own key stays on the server (env only). The BYOK
  orchestration is what gets tested in staging — not real user keys.
- Keys are never sent to the client, never logged, and never placed in the APK.

## 5. Control: Graceful Fallback, Then Disable

1. First failures (quota, rate limit, 5xx): transparent degradation — the
   already-standardized `SMS_FALLBACK_UNAVAILABLE` / assistant-unavailable paths
   run without alarming the user.
2. Repeated failures: the feature disables itself for that user and tells them
   their provider key needs attention. No retries storm; no silent infinite loops.

## 6. Pilot Program (14-Day Fixed Trial)

- Fixed 14-day window per user, decided up front. NOT consumed-balance billing
  (fixed scope keeps the pilot measurable and avoids building a wallet).
- Pilot pass produced **zero billable calls** against the synthetic environment:
  recorded evidence is expected-zero (by design), NOT a "zero result" finding.
  Full credit instrumentation lands with the production workflow — before real
  user traffic, not during.
- Success criteria: zero key leakage, zero cross-user mixing, clean
  enable→use→disable lifecycle, and the fallback policy behaving as specified.

## 7. Secret-Handling Rules (Standing)

- Raw SMS text never leaves the client except the sanitized extract to the
  server-side Gemini proxy (ADR-044 guardrails).
- A user's BYOK key is stored in transit/TLS only as a presentation credential;
  persistence strategy (encrypted-at-rest vs per-request-only) is decided in the
  production workflow phase — the pilot uses per-request-only.
- `flutter build apk` must run `--dart-define=GEMINI_API_KEY=…` with an empty or
  dev value. The release APK contains no provider key.
