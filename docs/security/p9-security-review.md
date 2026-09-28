# Phase P9 Security Review: Money, Subscriptions & Budgeting

## 1. Overview & Threat Modeling (STRIDE)

Phase P9 introduces financial accounting endpoints handling monetary transactions, subscriptions, budgets, and reporting summaries. Due to the high sensitivity of financial data and the risk of replay attacks, double-spending, and numerical discrepancies, this security review evaluates the implementation against the STRIDE threat model.

| Threat Category | Potential Vector | Mitigation in LifeStyle App |
|---|---|---|
| **Spoofing** | Unauthorized user forging transaction creation or payment | Strict Bearer JWT authentication on all routes via `authenticateUser` middleware. Access tokens expire in 15 minutes; refresh tokens use SHA-256 rotation. |
| **Tampering** | Modifying transaction amounts or manipulating subscription billing dates | Optimistic concurrency control (`version` check); pessimistic locking (`FOR UPDATE`) on subscription payments; parameter validation with ISO-4217 scales. |
| **Repudiation** | Denying transaction mutations or subscription charges | Mandatory audit logging in `audit_logs` table written synchronously inside the same ACID database transaction for all create, update, delete, and pay events. |
| **Information Disclosure** | Cross-tenant access to private financial transactions or budgets | Composite keys and strict repository scoping (`WHERE user_id = $userId`). Unowned entities return `404 Not Found` (never `403`), preventing resource enumeration. |
| **Denial of Service** | Flooding transaction creation or querying unbounded historical reports | Tiered Redis rate limiting (`writeTier`, `readTier`); hard quotas (max 50,000 transactions, 200 subscriptions, 100 budgets); report span capped at 366 days. |
| **Elevation of Privilege** | Modifying system categories or other users' categories | Default categories are seeded per-user (`user_id = user.id`); users can only modify their own categories. No shared/global editable entities exist. |

---

## 2. Race Conditions & Double-Payment Defense

### 2.1 The Idempotency Layer
Every state-changing financial mutation (`POST /money/transactions` and `POST /money/subscriptions/:id/pay`) mandates an `Idempotency-Key` HTTP header (UUID v4 format).
- **Deduplication Key Storage**: Stored in PostgreSQL `transactions.idempotency_key` with a partial unique index on non-deleted records.
- **Fingerprint Verification**: An SHA-256 hash of the normalized request payload is persisted alongside the idempotency key.
- **Replay vs Conflict**:
  - Exact match of key and payload: Returns `200 OK` with the existing transaction entity, avoiding duplicate database rows.
  - Same key with a different payload: Immediately rejected with `409 Conflict` (`IDEMPOTENCY_KEY_REUSED`).

### 2.2 Pessimistic Row Locking in Subscription Payment
To prevent race conditions where concurrent payment requests could double-bill a subscription cycle:
```sql
SELECT * FROM subscriptions
WHERE id = $subscriptionId AND user_id = $userId AND deleted_at IS NULL
FOR UPDATE;
```
1. The row is locked exclusively until the transaction commits.
2. The current `next_billing_date` is checked against existing transactions (`subscription_id` + `billing_date`).
3. If an expense transaction already exists for that billing date, the transaction rolls back with `409 Conflict` (`ALREADY_PAID_FOR_PERIOD`).
4. Database unique constraint `uq_transactions_subscription_billing` guarantees atomicity even in multi-node concurrency.

---

## 3. Monetary Arithmetic & Numerical Safety

### 3.1 Elimination of IEEE 754 Floating-Point Exploits
Floating-point arithmetic in JavaScript and non-decimal storage formats are susceptible to precision decay (e.g., $0.1 + 0.2 = 0.30000000000000004$).
- **API Payloads**: Amounts must be transmitted as JSON strings (e.g., `"19.99"`). Raw numbers (e.g., `19.99`) are rejected by Zod schemas (`typeof val !== 'string'`).
- **Database Storage**: Column definitions use `numeric(19,4) NOT NULL CHECK (amount > 0)`.
- **Validation**: Regex strictly bounds fractional digits to the maximum allowed by the currency's ISO-4217 specification (Scale 0, 2, or 3). Any extraneous precision (e.g., `"10.005"` for `USD`) is rejected with HTTP 400.

---

## 4. Multi-Tenant Isolation & Invariant Checks

### 4.1 Cross-Tenant Isolation
All SQL queries in `PgMoneyRepository` enforce ownership via parameterized `user_id`:
```typescript
query = query.where('user_id', '=', userId);
```
In compliance with the specification:
- Querying an ID belonging to another user yields `404 Not Found`.
- No error message leaks whether the resource exists under a different user account.

### 4.2 Cross-Kind Category Integrity
To prevent bookkeeping corruption (e.g., categorizing an expense under an income category):
- When a `categoryId` is provided for a transaction or budget, the repository verifies that the category is owned by the user and matches the expected kind:
  - Expense transactions require `category.kind === 'expense'`.
  - Income transactions require `category.kind === 'income'`.
  - Subscriptions (which represent periodic expenses) require `category.kind === 'expense'`.
- Violations return `400 VALIDATION_ERROR` with a descriptive error detail.

---

## 5. Audit Logging Architecture

Every state modification creates an immutable audit row in the `audit_logs` table:
```sql
INSERT INTO audit_logs (
  user_id, event_type, entity_type, entity_id,
  actor_ip, user_agent, outcome, metadata
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
```
- **Same Transaction**: The audit record is inserted within the exact same database transaction as the business entity change. If the business mutation fails, no orphan audit log is written. If the audit log fails, the entire transaction rolls back.
- **Sensitive Data Redaction**: The audit logger redacts sensitive authentication credentials, tokens, and PII, capturing only non-sensitive operational metadata (amounts, currencies, entity IDs).

---

## 6. Denial of Service & Abuse Protections

1. **Entity Quotas**:
   - Categories: Max 100 active categories per kind per user.
   - Transactions: Max 50,000 active transactions per user.
   - Subscriptions: Max 200 active subscriptions per user.
   - Budgets: Max 100 active budgets per user.
2. **Report Boundaries**:
   - Maximum date span between `from` and `to` is capped at 366 days.
   - Date formats are strictly validated (`YYYY-MM-DD`).
3. **Rate Limiting**:
   - Write endpoints: 30 requests/minute per IP/User.
   - Read endpoints: 120 requests/minute per IP/User.
