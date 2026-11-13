# Gemini API paid tier (the plan for the closed test)

Owner update, 2026-11-12: the owner has a card, so AI runs on the paid Gemini API (Tier 1) from
the first closed-test build. The unpaid tier stays documented as the fallback in
`docs/ai/gemini-free-tier.md`. Neither tier needs a code or key change. Checked against the Gemini
API billing, pricing and terms pages on 2026-11-12.

## Set up billing (owner, about 10 minutes)

1. AI Studio → Projects (or API keys) → the project that holds the key → **Set up billing** in the
   Billing Tier column.
2. Country, contact details and the card. Google Cloud takes Visa and Mastercard credit or debit
   cards, not prepaid or virtual cards. If the card is refused, ask the bank (app or phone) to
   enable online and international payments. If the card belongs to someone else, Google may ask
   the cardholder to verify it.
3. Prepay at least $5 (new accounts get the prepay plan). Credits expire after 12 months and are
   not refunded.
4. Check: the Projects page shows **Tier 1** in the Billing Tier column. The same API key now uses
   the paid tier; nothing changes in Railway or the code.
5. With Google AI Pro: after the prepay, claim the monthly Google Cloud credit through the Google
   Developer Program. Google spends those credits before the prepaid balance, but only while the
   prepaid balance is above $0.

## How the balance works

- Each request is paid from the prepaid balance, almost in real time.
- **At $0 every key on the billing account stops** (HTTP 402) until credits are added. The backend
  then answers with its generic provider error and the app says the assistant can't answer right
  now; nothing else in the app stops. The Railway log shows `AI provider request failed` with kind
  `provider_error`, and AI Studio shows "No credits".
- Optional: AI Studio → Billing → auto-reload, with a monthly auto-charge limit, so the balance
  never reaches $0. Without auto-reload, the balance is the spending limit.
- Tier 1 billing accounts have a $250 monthly cap.

## Cost (prices on 2026-11-12)

`gemini-3.5-flash-lite` (the default model): **$0.30 per million input tokens, $2.50 per million
output tokens** (thinking tokens count as output).

Rough cost per request, assuming about 4 English or 2 to 3 Arabic characters per token:

- a short message with little history (about 1,000 tokens in, 400 out): about $0.0013;
- the largest request the server accepts (24,000 characters of history, 800 tokens out): about
  $0.005.

20 testers sending about 15 AI requests a day cost roughly $0.40 a day, about $5 to $6 for the
14-day test. Worst case at a per-user cap of 50 a day with full-length chats: about $0.25 per
tester per day. Check the real numbers in AI Studio → Dashboard → Usage after the first days.

## Railway (backend service)

| Variable | Value | Note |
| --- | --- | --- |
| `AI_ENABLED` | `true` | |
| `GEMINI_API_KEY` | the key of the billed project | Server-side only |
| `AI_USER_DAILY_LIMIT` | `50` (recommended for the closed test) | Default 200. At 50, one account cannot spend more than about $0.25 a day |
| `AI_USER_MINUTE_LIMIT` | leave the default (`10`) | |

Leave `AI_PROVIDER` and `GEMINI_MODEL` at their defaults. If the free-tier values (25 and 3) were
set earlier, replace them.

## Store and documents

- Privacy policy (Google Doc), section 4: keep the **paid** paragraph in English and Arabic and
  delete the unpaid one.
- Data safety: Google processes AI requests on our behalf, so they are **not shared**; collected,
  ephemeral (`docs/store/data-safety-draft.md`, section 2).
- Tester guide: delete the lines marked "Delete if billing is on" before sending it.
- Countries: on the paid tier the Gemini terms allow users in the EEA, Switzerland and the United
  Kingdom. Opening those countries also brings GDPR duties that the policy draft does not cover
  yet. For the closed test, choose the countries where the testers live.
- The in-app AI notice says "Don't type passwords or sensitive information".

## First check

After PR #32 is merged and Railway has deployed it with the variables above: send one assistant
message in Arabic and one in English. Each reply should come in the language of its message, and
AI Studio → Dashboard → Usage should show the two requests.
