# Reporting AI replies (AI-P)

Google Play's AI-Generated Content policy requires apps that show AI-generated content
to let users report or flag offensive content without leaving the app. LifeStyle shows
AI text in three places: the AI assistant, the weekly coaching card and the analytics
insight. Each reply there has a report button. This page covers what a report holds,
the API, the owner SQL and how the owner reads reports. Background: Hybrid AI audit
`docs/reports/hybrid-ai-ai0-audit-2026-11-11.md`, findings AI0-F2 and decision D1.

## In the app (added 2026-11-12)

- A flag button with the tooltip "Report reply" (48 dp) sits next to AI text only: assistant
  replies once they have finished (not the welcome message), the weekly coaching card when the
  AI wrote it (not the offline summary), and the analytics insight when the AI wrote it (not
  the paused or error text).
- The sheet offers five reasons (offensive, harmful, inaccurate, spam, other), "Include the
  reply" (on by default), an optional note (at most 500 characters), Cancel and Send report.
  Send stays disabled until a reason is chosen. Success closes the sheet with "Thanks, we
  received your report". Any refusal (503 before the SQL, 429 after 10 reports in an hour,
  network) keeps the sheet open with "Couldn't send the report. Try again later.".
- Client: `lib/features/ai/data/ai_reports_client.dart` (`AiReportsClient`, POST
  `ai/reports`; the reply is trimmed and cut to 4,000 UTF-16 units and empty fields are left
  out). UI: `lib/features/ai/presentation/ai_report_sheet.dart`. Tests:
  `test/ai_reports_client_test.dart`, `test/ai_report_sheet_test.dart` (Arabic, 200 %,
  320 dp, G7 guidelines).
- Every AI feature first asks "Are you 18 or older?" once per account on the phone
  (`lib/features/ai/data/ai_age_confirmation.dart`, AI0-F11 / D9). Reporting needs no
  confirmation: it sends nothing to the AI.

## What a report holds

| Field | Meaning |
| :--- | :--- |
| `surface` | Where the reply was shown: `assistant`, `weekly_coaching` or `analytics_insight` |
| `category` | `offensive`, `harmful`, `inaccurate`, `spam` or `other` |
| `reply_text` | The reported reply. Only when the user left "Include the reply" ticked (on by default); at most 4,000 characters |
| `note` | Optional note from the user, at most 500 characters |
| `locale` | App language at the time of the report |
| `created_at` | Server time |

Nothing else is sent: no prompt, no conversation history, no task, note or habit data.
The body is never logged.

Lifecycle:

- Reports are deleted after **90 days** by the worker job `purge-ai-reports` (03:55
  every day).
- They are erased with the account (`ON DELETE CASCADE` and the account purge order).
- They appear in the JSON account export as `aiContentReports`.
- They are deliberately excluded from the versioned v1 archive file.
- The runtime role is append-only: it holds `SELECT, INSERT, DELETE` but not `UPDATE`.

## API

`POST /api/v1/ai/reports`. Authenticated, strict body: unknown fields are rejected.
Limits: 10 per hour and 30 per day per user. It is mounted outside the AI kill switch,
so an earlier reply can be reported while AI is off.

```json
{
  "surface": "assistant",
  "category": "offensive",
  "replyText": "optional, 1-4000 characters",
  "note": "optional, 1-500 characters",
  "locale": "ar"
}
```

Responses:

| Status | When |
| :--- | :--- |
| `201 {"reported": true}` | Stored (`Cache-Control: no-store`) |
| `400 VALIDATION_ERROR` | Unknown field, blank or over-long text, bad locale |
| `401` | No valid access token |
| `404` | Account missing or not active |
| `429 RATE_LIMITED` | Over the hourly or daily limit |
| `503 AI_REPORTS_UNAVAILABLE` | The owner SQL below has not been applied yet |

## Applying the owner SQL on production

Production (owner-managed Neon) has no migration ledger: never run
`npm run migrate:*` against it (see `docs/database/migrations.md`).

1. In the Neon console, create a branch of `production` (for example
   `ai-p-rehearsal`) and open the SQL Editor on it.
2. Paste and run the whole of `docs/ai/sql/ai-content-reports.sql` once. It is one
   transaction.
3. Run the verification queries below on the same branch.
4. Switch to `production`, run the file once, then the verification queries.
5. Delete the rehearsal branch.

**Status:** not applied yet.

Run it before publishing an app version that has the report button. Until it runs,
the app shows "Couldn't send the report", the API answers 503
`AI_REPORTS_UNAVAILABLE`, and export and account deletion skip the absent table.
Running the file a second time fails harmlessly with
`relation "ai_content_reports" already exists`; nothing is changed.

### Verification queries

```sql
SELECT has_table_privilege('lifestyle_app', 'public.ai_content_reports', 'SELECT') AS can_select,
       has_table_privilege('lifestyle_app', 'public.ai_content_reports', 'INSERT') AS can_insert,
       has_table_privilege('lifestyle_app', 'public.ai_content_reports', 'DELETE') AS can_delete,
       has_table_privilege('lifestyle_app', 'public.ai_content_reports', 'UPDATE') AS can_update;
-- expected: t, t, t, f

SELECT count(*) AS reports FROM ai_content_reports;
-- expected right after applying: 0
```

## Reading reports (owner, read-only)

Run this in the Neon SQL Editor on `production`, for example once a week during the
closed test. It shows the newest reports first and no account identifiers:

```sql
SELECT created_at, surface, category, locale, note, left(reply_text, 300) AS reply_start
FROM ai_content_reports
ORDER BY created_at DESC
LIMIT 50;
```

Use the reports to adjust the assistant's instructions and safety settings (AI-1), and
to answer the user if they wrote a note. Do not copy report text into issues, chats or
the repository.

## Rollback

Forward-only. The table is additive. To stop accepting reports, ship a backend without
the route; the app then shows its error message. Do not drop the table on production
without exporting it first, because it holds user submissions.
