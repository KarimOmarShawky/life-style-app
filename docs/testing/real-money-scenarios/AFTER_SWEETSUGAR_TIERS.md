# AFTER — Sweet Sugar Tiers checklist (BEFORE v0.95 → AFTER v1.0)

> Audit-era reconciliation (2026-10-10) of the `real-money-scenarios` manual test
> checklist (33 rows) against v1.0 code. 14 rows had real code changes (2 revert
> gates completed in the v0.95→v1.0 update + 11 cleanups), 13 rows are
> analysis-only, and 6 rows diverge from actual DB state (documented in the
> checklist's `diverge` column).

## Notable rows (diff table excerpt)

| Row | BEFORE (v0.95) | AFTER (v1.0) | Verdict |
| --- | --- | --- | --- |
| L1-01 | `sms_consent` toggle + `gemini_cors` mixed into wallet config | Consent toggle scoped to wallet; CORS is a server setting | code change ✓ |
| L1-12 | Transaction status only success | `status` + `error_message` columns + error state in flow | code change ✓ |
| L1-13 | Cards link to nothing | `debit_cards.account_id` FK (optional link) | code change ✓ |
| L2-13 | Recurring always on | `enableRecurringGeneration` switch (deferred rule: off in prod until a full product decision) | code change ✓ |
| O3-03 | Stop/cancel show raw tool output | STOP CANCEL & TOOL FAILURE new behaviour; local notification never shows raw SMS | code change ✓ |
| O3-12 | Timer requires a task | Task-less timer approved (ADR-044) | code change ✓ |
| cash-12 | 12 cash cases assume account-less income | Cash goes into a "محفظة كاش" account; all balances are sums | code change ✓ |
| restore | Rows vanish forever | Soft-delete restore window (30 days) with restore endpoint | code change ✓ |
| revert-1 | Revert of tier changes not tested | Revert gate #1 completed in the update | completed ✓ |
| revert-2 | Revert of money edits not tested | Revert gate #2 completed in the update | completed ✓ |

## Aggregates

- **14 rows with real code changes** — all implemented in v1.0 (the update +
  the follow-up cleanup batch).
- **13 rows analysis-only** — report wording, ordering, or expectations that do
  not change code; captured as report caveats (see `AFTER_TRANSACTION_MANAGEMENT.md`
  for the money-report double-count finding).
- **6 rows diverge from DB state** — checklist expects columns/enums the schema
  does not have (or vice versa); tracked in the checklist `diverge` column and
  resolved either by migration or by editing the expectation.

## How to re-run

Follow the checklist row-by-row against a populated database. Numeric
walkthroughs use the synthetic script in `AFTER_TRANSACTION_MANAGEMENT.md`.
