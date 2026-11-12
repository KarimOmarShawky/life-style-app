# Google Play — Data safety and App content answers (DRAFT)

> **Draft for the owner, 2026-11-12**, written from the code on branch
> `arena/04c63949-life-style-app` (PR #32). Play Console wording changes over time, so
> check each answer against the form. Fill in the App content sections before the first
> closed-test release. The answers must match the published privacy policy
> (`docs/store/privacy-policy-draft.md`). Not legal advice.

## 1. Data collection and security (top of the form)

| Question | Answer | Why |
| :--- | :--- | :--- |
| Does your app collect or share any of the required user data types? | **Yes** | Account, content synced to our server, optional usage events, AI requests |
| Is all of the user data collected by your app encrypted in transit? | **Yes** | HTTPS only; the signed release job refuses a non-HTTPS API URL |
| Account creation methods | **Username (email) and password** | `POST /auth/register` |
| Delete account URL | **[deletion page URL]** (required) | See section 5 |
| Can users request deletion of some data without deleting the account? | **Yes** | They can delete individual items in the app; owner may answer No to keep it simple |

## 2. Data types

"Collected" = sent off the phone (to our server or to Google). Data that never leaves the phone
is not declared (AI chat history, Focus Shield, the message shield, reminders).

| Category → type | Collected | Shared | Ephemeral | Required / optional | Purposes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Personal info → Email address | Yes | No | No | Required | Account management, App functionality |
| Personal info → Name (display name) | Yes | No | No | Required | App functionality, Account management |
| Personal info → User IDs (account id) | Yes | No | No | Required | Account management, App functionality |
| Financial info → Other financial info (subscription reminders: name, price, renewal date) | Yes | No | No | Optional | App functionality |
| App activity → App interactions (usage events, opt-out) | Yes | No | No | Optional | Analytics |
| App activity → Other user-generated content (tasks, notes, habits, goals, events, plans) | Yes | No | No | Optional | App functionality |
| App activity → Other user-generated content (AI requests: assistant messages, weekly or analytics numbers, Smart Quick Add text) | Yes | **See below** | **Yes**: our server does not store them | Optional | App functionality |
| App activity → Other user-generated content (reports of AI replies, kept 90 days) | Yes | No | No | Optional | App functionality; Fraud prevention, security and compliance |

Not collected: location (IP addresses are kept in security logs but no location is derived from
them; review this choice in the form's guidance), contacts, photos and videos, audio, files,
messages (SMS, or notification content read by the message shield: on the phone only), health
and fitness, web browsing, calendar of other apps, device or advertising IDs, crash logs and
diagnostics (no crash or analytics SDK).

**AI requests, "Shared" or not:**
- **Paid Gemini API (Tier 1), the plan from the first closed-test build (owner, 2026-11-12):**
  Google processes the requests on our behalf as a service provider, so they are **not shared**.
  Mark collected, ephemeral. Setup: `docs/ai/gemini-paid-tier.md`.
- **Unpaid Gemini API (closed test fallback):** Google may use what is sent to improve its
  products. That goes beyond processing on our behalf, so declare this type as **shared**
  (with Google, for App functionality). Correct it when billing is switched on, and switch
  before the production launch.

## 3. Security practices

- Data is encrypted in transit: **Yes**.
- Users can request that data is deleted: **Yes**. In the app: Profile → Delete account, 14-day
  grace period. Outside the app: the deletion page.
- Independent security review / Families policy: **No**.

## 4. Other App content sections

| Section | Answer |
| :--- | :--- |
| Privacy policy | Public URL of the published `privacy-policy-draft.md` (not a PDF) |
| Ads | No ads |
| App access | Give reviewers a working test account (email and password) **and** say that AI needs the 18+ confirmation. Without a login, review fails. Don't commit the credentials to this repository. |
| Target audience and content | **18 and over only** (Gemini API terms; AI0-F11 / D9). Not designed for children. |
| Content rating (IARC) | Answer the questionnaire honestly: the app has an AI chatbot that generates text and lets users report replies in the app; there is no user-to-user sharing |
| Generative AI | In-app report of AI replies: **implemented** (flag on every AI reply → `POST /api/v1/ai/reports`) |
| Financial features | The app provides no financial features (subscription reminders are a personal list, not a financial service) |
| Health | Not a health app |
| News / government / COVID-19 | No |
| **Permissions → Accessibility API** | **Required.** The manifest declares `FocusShieldAccessibilityService`. Declare it as **not an accessibility tool**. Purpose: Focus Shield sends the user back from apps they chose to block during a focus session they started. `canRetrieveWindowContent=false`: no screen content is read. The in-app explanation and consent come before Android's settings open (`detox_screen.dart`). Play asks for a short video of this flow: enable it from the app, block an app, and show the return. |
| Exact alarms | `SCHEDULE_EXACT_ALARM` (user-granted, with an inexact fallback); no `USE_EXACT_ALARM`, so no declaration is expected |
| Notification access | `FocusNotificationListenerService` is turned on by the user in Android settings; content stays in memory on the phone; mention it in the privacy policy (done) |

## 5. Account deletion web page (required by Play)

Play needs a public web page where people can request deletion without reinstalling the app.
Minimum content (host it next to the privacy policy):

> **Delete your LifeStyle account**
> In the app: Profile → Delete account. You have 14 days to cancel; then your account and its
> data are deleted. Without the app: email [contact email] from your account's email address
> with the subject "Delete my account". We confirm by email and delete within 14 days.
> Deleted: account, tasks, habits, notes, goals, events, plans, subscription reminders, usage
> events and reports of AI replies. Security logs are kept up to 12 months, then deleted.

The owner handles these emails with `docs/auth/account-deletion-requests.md` (owner SQL
`docs/auth/sql/schedule-account-deletion-on-request.sql`, the same steps as the in-app request).

## 6. Owner checks before submitting

- [ ] Choose the Gemini paragraph (paid or unpaid) in the privacy policy and match section 2.
- [ ] Fill in placeholders: developer name, contact email, providers and regions, deletion URL.
- [ ] Railway: confirm `DATABASE_MAINTENANCE_URL` is set. Without it the 12-month
      security-log deletion is not scheduled, and the policy's 12-month statement would be wrong.
- [ ] Apply the AI-P SQL (`docs/ai/sql/ai-content-reports.sql`) before testers can report replies.
- [ ] Record the Accessibility video and submit the declaration.
- [ ] Re-check this form when a new SDK, permission or data type is added (ADR-039 still
      forbids new SDKs without an ADR).
