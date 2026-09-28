# Architecture: Money, Subscriptions & Budgeting Domain

## 1. Executive Summary & Design Scope

The Money domain provides core personal finance management capabilities within the LifeStyle App:
- **Categories**: Expense and income taxonomies with system defaults seeded at user registration and user-defined custom categories.
- **Transactions**: Double-entry-adjacent ledger records representing discrete income and expense events with exact monetary scale adherence and idempotency protection.
- **Subscriptions**: Recurring billing contracts featuring drift-free cycle math anchored to a civil date, month-end day clamping, monthly equivalent normalization, and atomic "Mark as Paid" processing.
- **Budgets**: Target spending envelopes calculated dynamically at read time over the user's local calendar month, supporting both overall expenditure and category-specific constraints.
- **Financial Reports**: Bounded aggregation summaries providing net income, expense breakdown, uncategorized tracking, and time-series bucketing across configurable horizons.

In strict compliance with the LifeStyle App Specification v1.0.1, the Money domain adheres to:
1. **PostgreSQL 16 as Single Source of Truth**: All domain entities reside in relational tables with foreign keys and composite uniqueness constraints. No MongoDB, no general file storage, no multi-currency forex conversion, and no external banking sync.
2. **Fixed-Point Precision (`numeric(19,4)`)**: API payloads exchange exact string representations of decimal amounts. IEEE 754 floating point values in JSON payloads are rejected by schema validators.
3. **Strict Multi-Tenant Isolation**: Ownership is enforced at the repository layer. Attempted queries or mutations on unowned resources yield `404 Not Found`.

---

## 2. Monetary Precision & ISO-4217 Scale System

### 2.1 Storage & Schema Invariants
Monetary amounts are stored in PostgreSQL using `numeric(19,4)`:
```sql
amount numeric(19,4) NOT NULL CHECK (amount > 0)
```
This guarantees exact representation of monetary amounts without IEEE 754 floating-point truncation or binary rounding drift.

### 2.2 ISO-4217 Exponent Scaling
Currencies have differing minor unit scales:
- **Scale 0**: Zero-decimal currencies (e.g., `JPY`, `KRW`, `CLP`, `VND`).
- **Scale 2**: Standard decimal currencies (e.g., `USD`, `EUR`, `GBP`, `CAD`, `AUD`).
- **Scale 3**: Three-decimal currencies (e.g., `BHD`, `JOD`, `KWD`, `OMR`, `TND`).

In `money.validation.ts` and `money.dto.ts`:
- String validation regex enforces the exact maximum decimal places for each currency (`CURRENCY_EXPONENTS` mapping).
- Any attempt to submit an amount exceeding the currency's ISO exponent (e.g., `10.555` for `USD` or `100.5` for `JPY`) is rejected with `VALIDATION_ERROR` (HTTP 400).

```
API Request: "0.10" + "0.20" USD
PostgreSQL:  0.1000 + 0.2000 = 0.3000
API DTO:     "0.30"
```

---

## 3. Subscription Cycle Mathematics & Drift Prevention

### 3.1 Anchor Date Preservation
A common pitfall in recurring billing systems is cycle drift (e.g., adding 30 days or advancing month-by-month from previous truncated dates). The LifeStyle App computes all cycle dates relative to the immutable `anchor_date`:

$$N_{billing} = f(\text{anchor\_date}, \text{cycle\_index}, \text{unit}, \text{interval})$$

### 3.2 Month-End Clamping Algorithm
When an anchor date falls on the 29th, 30th, or 31st of a month, subsequent shorter months clamp to their respective last calendar day. However, when the cycle reaches a longer month, the date restores to the original anchor day:
- **Example (Monthly, Anchor `2026-01-31`)**:
  - Cycle 0: `2026-01-31`
  - Cycle 1 (February): `2026-02-28` (clamped to end of Feb in non-leap year)
  - Cycle 2 (March): `2026-03-31` (restored to 31st)
  - Cycle 3 (April): `2026-04-30` (clamped to 30th)
  - Cycle 4 (May): `2026-05-31` (restored to 31st)

Implementation in `money.cycle.ts`:
```typescript
export function computeNextBillingDate(
  anchorDate: string,
  currentDate: string,
  billingUnit: SubscriptionBillingUnit,
  billingInterval: number
): string {
  // Parses year, month, day from anchorDate
  // Steps forward by billingInterval * unit
  // Clamps day to Math.min(anchorDay, daysInMonth(nextYear, nextMonth))
}
```

### 3.3 Derived Attributes
When listing or fetching subscriptions, two read-time attributes are derived:
1. `monthlyEquivalent`: Normalized monthly expenditure calculated with high-precision arithmetic:
   - Weekly: $\text{amount} \times \frac{52}{12 \times \text{interval}}$
   - Monthly: $\frac{\text{amount}}{\text{interval}}$
   - Yearly: $\frac{\text{amount}}{12 \times \text{interval}}$
2. `daysUntilNextBilling`: Integer difference between `nextBillingDate` and "today" in the user's configured IANA timezone:
   $$\text{daysUntilNextBilling} = \text{diffDays}(\text{userToday}, \text{nextBillingDate})$$

---

## 4. Atomic "Mark as Paid" Workflow

Paying a subscription advances the subscription's next billing cycle and records an expense transaction in a single atomic database transaction.

```
Client                     MoneyController           MoneyService             PgMoneyRepository       PostgreSQL
  |                              |                         |                          |                   |
  |-- POST /subscriptions/:id/pay ->|                      |                          |                   |
  |   (Idempotency-Key)          |                         |                          |                   |
  |                              |-- paySubscription() --->|                          |                   |
  |                              |                         |-- paySubscription() ---->|                   |
  |                              |                         |                          |-- BEGIN TRX ----->|
  |                              |                         |                          |-- SELECT ... FOR UPDATE ->
  |                              |                         |                          |-- Verify status = 'active'
  |                              |                         |                          |-- Check existing tx for (sub_id, billing_date)
  |                              |                         |                          |-- INSERT INTO transactions ->
  |                              |                         |                          |-- UPDATE subscriptions SET next_billing_date ->
  |                              |                         |                          |-- INSERT INTO audit_logs (tx & sub) ->
  |                              |                         |                          |-- COMMIT -------->|
  |                              |                         |<-- { tx, sub } ----------|                   |
  |                              |<-- { tx, sub } ---------|                          |                   |
  |<-- 201 Created --------------|                         |                          |                   |
```

### 4.1 Invariants & Concurrency Guards
1. **Pessimistic Row Locking (`FOR UPDATE`)**: Prevents concurrent requests from simultaneously advancing the cycle.
2. **Duplicate Payment Prevention**: Queries for existing transactions matching `(subscription_id, billing_date)`. If one exists, transaction aborts with `409 ALREADY_PAID_FOR_PERIOD`.
3. **Database Unique Constraint**:
   ```sql
   UNIQUE(subscription_id, billing_date) WHERE deleted_at IS NULL
   ```
   Provides database-level guarantee against duplicate billing even in edge-case race conditions.
4. **Audit Trail**: Writes two distinct entries to `audit_logs` within the same transaction: `transaction.created` and `subscription.paid`.

---

## 5. Read-Time Budget Usage Engine

Budgets in LifeStyle App do not maintain denormalized spending accumulators. Instead, usage is evaluated dynamically at read time.

### 5.1 Calendar Month Windowing in User Timezone
Budget periods are anchored to the user's local calendar month. The system uses the user's IANA timezone (e.g., `Africa/Cairo`, `America/New_York`) to resolve:
1. `currentDate`: The local civil date (`YYYY-MM-DD`).
2. `periodStart`: The 1st day of the local calendar month (`YYYY-MM-01`).
3. `periodEnd`: The last day of the local calendar month (`YYYY-MM-LD`).

### 5.2 Single-Pass Aggregation
The repository executes a SQL query summing all active expense transactions within the month:
```sql
SELECT COALESCE(SUM(amount), 0)::text as spent
FROM transactions
WHERE user_id = $1
  AND kind = 'expense'
  AND currency = $2
  AND occurred_on >= $3
  AND occurred_on <= $4
  AND ($5::uuid IS NULL OR category_id = $5)
  AND deleted_at IS NULL;
```

### 5.3 Computed Usage Metrics
The derived `usage` payload contains:
- `spent`: String representation of total expense within the window.
- `remaining`: $\max(0, \text{amount\_limit} - \text{spent})$.
- `percentUsed`: $\text{round}\left(\frac{\text{spent}}{\text{amount\_limit}} \times 100, 1\right)$.
- `overspent`: Boolean flag indicating whether $\text{spent} > \text{amount\_limit}$.

### 5.4 Unique Constraints & Quotas
- Uniqueness is enforced at the database level:
  ```sql
  CREATE UNIQUE INDEX uq_budgets_user_category_currency_period
  ON budgets (user_id, category_id, currency, period)
  WHERE deleted_at IS NULL;
  ```
- Overall budgets (`categoryId: null`) and category-specific budgets are uniquely indexed per currency and period (`monthly`).
- A maximum quota of **100 active budgets** per user is enforced at creation.

---

## 6. Financial Reports Engine

The reporting service (`GET /money/reports/summary`) aggregates financial performance:
1. **Bounded Horizon**: Rejects query ranges spanning more than 366 days (`MAX_REPORT_SPAN_DAYS`).
2. **Category Aggregation**: Aggregates total expenditure and income by category, calculating the percentage share of total volume.
3. **Uncategorized Tracking**: Transactions where `categoryId IS NULL` are explicitly grouped as:
   ```json
   {
     "categoryId": null,
     "name": "Uncategorized",
     "kind": "expense",
     "total": "50.00",
     "count": 1,
     "share": 10.0
   }
   ```
4. **Time-Series Bucketing**: Supports grouping by `day`, `week`, or `month`, generating period buckets with total income and expense for chart visualization.

---

## 7. Multi-Tenant Security & Repository Scoping

Every database operation enforces `WHERE user_id = $userId`. Attempts to:
- Read unowned categories, transactions, subscriptions, or budgets
- Link unowned categories to transactions or subscriptions
- Update or delete unowned records

Fail the ownership predicate and return `404 Not Found` without revealing resource existence to unauthorized actors.
