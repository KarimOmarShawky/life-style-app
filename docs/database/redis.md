# Redis Usage & Key Catalog

> **Specification Reference:** Section 12 & ADR-001, ADR-015

## 1. Role of Redis in MVP

Redis 7 is used **strictly for temporary, ephemeral, and cache-like infrastructure state**.  
No business data is ever mastered in Redis. All data in Redis must be safely reconstructible from PostgreSQL or safe to lose without data loss.

---

## 2. Key Pattern Catalog

| Key Pattern | Data Type | TTL | Purpose |
| :--- | :--- | :--- | :--- |
| `ratelimit:<key>` | Integer counter | 60s – 3600s | Sliding / fixed window API request rate limiting |
| `pwreset:<email_hash>` | Hash / String | 15 minutes | Password-reset 6-digit OTP verification state |
| `bull:*` | Sorted Sets / Streams | Managed by BullMQ | Background job scheduling and worker queue coordination |

---

## 3. Failure Mode Policy

* **Rate Limiting Failure:** If Redis becomes temporarily unreachable, the rate limiter fails open (logs a warning and permits the request) to preserve application availability (Spec §12.2 / A-17).
* **Password Reset Failure:** If an OTP key is lost during a Redis flush, the user simply requests a new reset code.
* **Queue Replay:** BullMQ queue items reference PostgreSQL IDs; recurring generation and reminder dispatchers verify PostgreSQL state before taking action.
