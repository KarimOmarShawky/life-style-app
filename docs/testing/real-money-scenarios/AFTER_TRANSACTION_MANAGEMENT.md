# AFTER — Transaction Management (real-money scenarios)

> Audit-era reconciliation (2026-10-10) of `docs/testing/real-money-scenarios/`
> transaction-management sections against v1.0 code. The synthetic-database
> numeric walkthrough is preserved here because it reproduces a real report bug.

## 1. Reproduction Script (synthetic dataset)

The following script rebuilds the synthetic transaction data used in the report
walkthrough (`fake_transaction_cents` uses integer minor units, matching the
Money design):

```sql
CREATE TABLE fake_transaction_cents (
  id BIGSERIAL PRIMARY KEY,
  account_id UUID NOT NULL,
  user_id UUID NOT NULL,
  posted_at TIMESTAMPTZ NOT NULL,
  amount_cents INTEGER NOT NULL,          -- signed: +income / -expense
  source TEXT NOT NULL CHECK (source IN ('manual', 'sms', 'sms_review', 'recurring')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'cancelled', 'error'))
);

-- Monthly expense = SUM(amount_cents) WHERE amount_cents < 0, grouped by month
-- Balance = SUM(amount_cents) over ALL rows per account (source of truth)
```

## 2. The Diff Table (report vs implementation)

| Area | BEFORE (report) | AFTER (code, v1.0) | Verdict |
| --- | --- | --- | --- |
| Balance source | Report adds running transaction totals to the displayed account balance | Balance is stored on the account; transactions are history | Report double-counts |
| Amount storage | Decimal EGP | `integer` minor units (`cents`), currency per account | Report wrong |
| SMS rows | Counted as completed | `sms_review` pending rows must not hit balance until reviewed | Report inflates |
| Recurring | Report ignores generation lag | `recurring_transactions` runs nightly; lag rows appear next cycle | Analysis-only |
| Cancelled/error | Report counts them | `cancelled`/`error` rows are excluded from balance by CHECK | Report inflates |
| Categories | Report shows uncategorised totals | `categorised_at` + bulk-categorise flow exists | Analysis-only |

Aggregates from the reconciliation: rows with real code changes were completed in
the update; analysis-only rows remain as documented report caveats; a subset
diverges from actual DB state and is listed in the checklist's `diverge` column.

## 3. Conclusions & Recommendations

1. **The report's assets figure is inflated**: it adds the account balance
   (already the sum of transactions) to a running transaction total — double
   counting. Fix the report (use the account balance as-is) or restore the
   DATE-based view the report was written against.
2. `sms_review` pending rows must never affect balance until the user confirms
   them (matches the low-confidence confirmation rule in ADR-044).
3. The numeric walkthrough remains a valid acceptance procedure — run it after
   any Money change, against the synthetic script above.
