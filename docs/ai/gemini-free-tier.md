# Running the closed test on the unpaid Gemini API

> **Fallback only (update, 2026-11-12).** The owner has a card, so the plan is the paid tier:
> see `docs/ai/gemini-paid-tier.md`. Use this page only if billing becomes unavailable.

Owner decision, 2026-11-12: start the closed test on the unpaid ("free") Gemini API and add
billing later. The app and the backend need no code change for either tier; this page lists the
settings and the limits. Checked against the Gemini API Additional Terms (effective 2026-03-23) and
the rate-limit page on 2026-11-12.

## What the terms require on the unpaid tier

- **No users in the EEA, Switzerland or the United Kingdom.** The rule is about where users are,
  not the app language. Restrict the countries in Play Console instead of removing languages.
- **Google may use the content.** Prompts and replies may be used to improve Google's products,
  and human reviewers may read them. The terms say: do not submit sensitive, confidential or
  personal information. So the privacy policy uses its unpaid paragraph, Data safety says
  "shared with Google" and testers are told. The in-app AI notice says "Don't type passwords or
  sensitive information"; on this tier it should also name personal details, which needs an app
  update in six languages (`aiEgressDescription`).
- Unchanged on both tiers: users must be 18 or older (the app asks once), no medical advice.

## Limits

Google no longer publishes the free numbers; read them in AI Studio → Rate limit. Third-party
measurements in October and November 2026 report about **500 requests a day and 10 to 15 a minute**
for `gemini-3.5-flash-lite` (our default model), and about 20 a day for the Flash models. The
limits apply to the whole Google Cloud project, not per user or per key. The daily count resets at
midnight Pacific time, about 10:00 in Cairo. Keep `GEMINI_MODEL` on the Flash-Lite default.

Each AI action is one request: an assistant message, a weekly coaching summary, an analytics
insight, or a Smart Quick Add parse when AI help is on.

## Settings (owner)

1. AI Studio → Get API key (no billing).
2. Railway (backend service) variables:

   | Variable | Free-tier value | Default | Why |
   | --- | --- | --- | --- |
   | `AI_ENABLED` | `true` | `false` | Turns the AI endpoints on |
   | `GEMINI_API_KEY` | the key from step 1 | — | Server-side only |
   | `AI_USER_DAILY_LIMIT` | `25` | `200` | One tester cannot use up the project's day (20 × 25 = 500) |
   | `AI_USER_MINUTE_LIMIT` | `3` | `10` | The project allows only 10 to 15 a minute in total |

   Leave `AI_PROVIDER` (`gemini`) and `GEMINI_MODEL` unset or at their defaults.
3. Play Console:
   - Closed testing track → Countries/regions: leave out the 27 EU countries, Iceland,
     Liechtenstein, Norway, Switzerland and the United Kingdom. Invite testers who live elsewhere.
   - App content → Data safety: AI messages are **shared** with Google (see
     `docs/store/data-safety-draft.md`).
4. Privacy policy (Google Doc): keep the unpaid paragraph in section 4, in English and Arabic.
5. Tester guide: keep the two lines marked "Delete if billing is on".

When the daily limit is reached, AI requests fail with the backend's generic provider error and
the app shows its "can't answer right now" message. After three failures in a row the app pauses
AI requests until it is closed and opened again (the pause has no timer; finding AI1-F2 in
`docs/reports/hybrid-ai-ai1-report-2026-11-12.md`). Nothing else in the app stops.

## Before the public release

The unpaid tier was chosen for the closed test. In production people will write about their lives,
which the terms say not to send to the unpaid tier, and the policy's unpaid paragraph is worded
for the test. If billing is still missing at launch, release with `AI_ENABLED=false` (the app works
without AI and nothing waits on it) and turn it on after billing, without a new build.

## Switching to the paid tier

1. AI Studio → Set up billing on the **same** project ($5 minimum prepay). The same key moves to
   Tier 1, usually at once. No code or key change.
2. Railway: set `AI_USER_DAILY_LIMIT` and `AI_USER_MINUTE_LIMIT` back (or remove them), and add a
   budget alert. With prepaid billing every key stops at a balance of $0.
3. Privacy policy: replace the unpaid paragraph with the paid one. Data safety: AI messages are
   processed for us, not shared. Delete the two "Delete if billing is on" lines in the tester
   guide. Opening EEA, Swiss and UK countries is then allowed.
4. What was sent during the unpaid period stays under the unpaid terms; the policy said so then.
