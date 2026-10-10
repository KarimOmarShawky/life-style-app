/**
 * src/features/ingest/sms-sanitizer.ts
 *
 * Server-side redaction for SMS-derived text. The SMS fallback path may only ever
 * hand sanitized text to the Gemini model, and model output is sanitized again
 * before it is returned to the client ("re-sanitize"). Raw SMS bodies must never
 * be sent to third parties or written to logs.
 *
 * Redacted categories (placeholders are stable and safe to keep in output):
 * - OTP / verification codes                      -> [OTP]
 * - phone, account, card and reference numbers    -> [PHONE] / [ACCOUNT] / [REFERENCE]
 * - URLs and email addresses                      -> [URL] / [EMAIL]
 * - balance and fee details                       -> [BALANCE] / [FEE]
 * - dates                                         -> [DATE]
 * - percentages                                   -> [PERCENT]
 * - promotional text                              -> [PROMO]
 *
 * Transaction amounts (numbers tied to a currency or money keyword, with at most
 * a decimal part) are preserved so the analyzer can extract them. Numbers that
 * cannot be told apart from references (bare runs of 7+ digits) are redacted on
 * purpose: over-redaction degrades the parse to "needs review", while
 * under-redaction leaks financial identifiers.
 *
 * Note: `\b` word boundaries are ASCII-only in JavaScript, so Arabic patterns use
 * `(?<![\p{L}\p{N}_])` / `(?![\p{L}\p{N}_])` lookarounds with the `u` flag instead.
 */

export const REDACTION_TOKENS = {
  otp: '[OTP]',
  phone: '[PHONE]',
  account: '[ACCOUNT]',
  reference: '[REFERENCE]',
  url: '[URL]',
  email: '[EMAIL]',
  balance: '[BALANCE]',
  fee: '[FEE]',
  date: '[DATE]',
  percent: '[PERCENT]',
  promo: '[PROMO]',
  unknown: '[UNKNOWN]'
} as const;

const MAX_SANITIZED_LENGTH = 600;
const MAX_MERCHANT_LENGTH = 60;
const MAX_DESCRIPTION_LENGTH = 500;

const URL_PATTERN = /\b(?:https?:\/\/\S+|www\.\S+)/giu;
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// Masked card numbers ("**** 1234", "****-****-****-1234").
const MASKED_CARD_PATTERN = /\*{2,}[\d* -]{2,}?\d/g;
// Long unbroken card-like digit runs (12-19 digits, no decimals).
const CARD_DIGIT_PATTERN = /(?<![\d*])(?:\d[ -]?){12,19}(?![\d*])/g;

// Numbers that carry an account / reference label. The label is kept, the digits go.
const REFERENCE_LABELLED_PATTERN =
  /(?<label>(?<![\p{L}\p{N}_])(?:ref(?:erence)?(?:\s+(?:no|number|code))?|transaction\s+(?:id|no|number)|txn\s*(?:id|no)?|trace)(?![\p{L}\p{N}_])[\s:=\-]*)(?<digits>\*{0,4}[\d*][\d* -]{1,}[\d*])/giu;
const REFERENCE_LABELLED_AR_PATTERN =
  /(?<label>(?<![\p{L}\p{N}_])(?:رقم المرجع|المرجع|رقم العملية)(?![\p{L}\p{N}_])[\s:=\-]*)(?<digits>\*{0,4}[\d*][\d* -]{1,}[\d*])/gu;
const ACCOUNT_LABELLED_PATTERN =
  /(?<label>(?<![\p{L}\p{N}_])(?:account|acc|a\/c|acct|iban|card(?:\s+(?:no|number))?)(?![\p{L}\p{N}_])[\s:=\-]*)(?<digits>\*{0,4}[\d*][\d* -]{1,}[\d*])/giu;
const ACCOUNT_LABELLED_AR_PATTERN =
  /(?<label>(?<![\p{L}\p{N}_])(?:رقم الحساب الالي|رقم الحساب|الحساب|رقم البطاقة)(?![\p{L}\p{N}_])[\s:=\-]*)(?<digits>\*{0,4}[\d*][\d* -]{1,}[\d*])/gu;

// OTP codes following an OTP-ish label. The label itself stays so the analyzer can
// still tell that the message was a one-time password, not a transaction.
const OTP_PATTERN =
  /(?<label>(?<![\p{L}\p{N}_])(?:otp|one[\s-]?time\s+(?:password|code|pin)|verification\s+code|pin\s+code)(?![\p{L}\p{N}_])[\s:=\-]*(?:is[\s:=\-]+)?)(?<code>\d{4,8}(?![\d])|\b[A-Z0-9]{6,8}\b)/giu;
const OTP_AR_PATTERN =
  /(?<label>(?<![\p{L}\p{N}_])(?:كود التحقق|رمز التحقق|الرمز السري|كلمة المرور)(?![\p{L}\p{N}_])[\s:=\-]*(?:هو[\s:=\-]+)?)(?<code>\d{4,8}(?![\d])|[A-Z0-9]{6,8}(?![\p{L}\p{N}_]))/gu;

// Phone numbers: international with +, local with a leading zero, or grouped triples.
// A trailing "." is a sentence period unless a digit follows (then it is a decimal).
const INTL_PHONE_PATTERN = /(?<![\dA-Za-z])\+(?:\d[\s.\-]?){7,15}\d(?![\d]|\.\d)/g;
const LOCAL_PHONE_PATTERN = /(?<![\d.])0\d{9,14}(?![\d]|\.\d)/g;
const GROUPED_PHONE_PATTERN = /(?<![\d.])\d{3}[\s.\-]\d{3}[\s.\-]\d{3,4}(?![\d]|\.\d)/g;

// Dates: ISO, slashed/dashed numeric, and day-month name in English and Arabic.
const ISO_DATE_PATTERN = /(?<![\d])\d{4}-\d{2}-\d{2}(?![\d])/g;
const NUMERIC_DATE_PATTERN = /(?<![\d.])\d{1,2}[/.]\d{1,2}[/.]\d{2,4}(?![\d])/g;
const DAY_MONTH_DATE_PATTERN =
  /(?<![\d])\d{1,2}(?:st|nd|rd|th)?[\s\-]+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?![\p{L}\p{N}_])/giu;
const MONTH_DAY_DATE_PATTERN =
  /(?<![\p{L}\p{N}_])(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-]+\d{1,2}(?:st|nd|rd|th)?(?![\d])/giu;
const ARABIC_DATE_PATTERN =
  /(?<![\p{L}\p{N}_])\d{1,2}\s*(?:يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)/gu;
// Short "8/10" or "8-10" day/month pairs (dot-free so decimal amounts are safe).
const SHORT_DATE_PATTERN = /(?<![\d.\-/])\d{1,2}[/-]\d{1,2}(?![\d\-/]|%|\.\d)/g;

const PERCENT_PATTERN = /(?<![\d.])\d+(?:\.\d+)?\s*(?:%|بالمائة|بالمئة|في المئة|percent)/giu;

const CURRENCY_SUFFIX = String.raw`(?:\s*(?:egp|usd|eur|gbp|aed|sar|le|l\.e\.?|جنيه|ج\.م|جم|درهم|ريال))?`;
const AMOUNT_TAIL = String.raw`\d[\d.,]*${CURRENCY_SUFFIX}`;

const BALANCE_EN_PATTERN = new RegExp(
  String.raw`(?<prefix>(?<![\p{L}\p{N}_])(?:available\s+balance|current\s+balance|closing\s+balance|balance|bal)(?![\p{L}\p{N}_])[\s:=(\-]*)(?<amount>${AMOUNT_TAIL})`,
  'giu'
);
const BALANCE_AR_PATTERN = new RegExp(
  String.raw`(?<prefix>(?<![\p{L}\p{N}_])(?:الرصيد\s+المتاح|رصيدك|الرصيد|المتاح|متاح|متوفر)(?![\p{L}\p{N}_])[\s:=(\-]*)(?<amount>${AMOUNT_TAIL})`,
  'gu'
);
const FEE_EN_PATTERN = new RegExp(
  String.raw`(?<prefix>(?<![\p{L}\p{N}_])(?:fees?|charges?|commission)(?![\p{L}\p{N}_])[\s:=(\-]*(?:of|:)?[\s]*)(?<amount>${AMOUNT_TAIL})`,
  'giu'
);
const FEE_AR_PATTERN = new RegExp(
  String.raw`(?<prefix>(?<![\p{L}\p{N}_])(?:رسوم|عمولة|مصاريف)(?![\p{L}\p{N}_])[\s:=(\-]*(?:of|:)?[\s]*)(?<amount>${AMOUNT_TAIL})`,
  'gu'
);

// Promotional sentences are dropped whole. Bare "خصم" is intentionally NOT a cue:
// it is a debit keyword ("charged 500") and must survive.
const PROMO_EN_PATTERN =
  /\b(?:for more (?:info|information|details)|to (?:know|get|see) more|visit (?:our|us|www)|call (?:us|customer care|customer service)|customer (?:care|service)|hotline|toll[ -]?free|terms (?:and|&) conditions|message and data rates|unsubscribe|opt out|promo(?: code)?|use code|special offer|limited time|voucher|download (?:our|the) app)/iu;
const PROMO_AR_PATTERN =
  /(?<![\p{L}\p{N}_])(?:اشحن رصيدك|اشحن|اشترك|للمزيد|خدمة العملاء|اتصل بنا|الخط الساخن|عرض (?:خاص|اليوم|مميز)|خصم (?:خاص|مميز)|توصيل مجان[يا]|حمل(?:وا)? التطبيق|تابعونا|زور[وا]|الغاء الاشتراك|استمتع بخصم)(?![\p{L}\p{N}_])/iu;
const SENTENCE_SPLIT_PATTERN = /(?<=[.!?\u061F\n\u061B])/;

// Bare digit runs of 7+ digits with no decimal context are reference/track numbers.
// A run followed by "." + digit is a decimal amount and must survive.
const BARE_LONG_DIGITS_PATTERN = /(?<![\d.,])\d{7,}(?![\d]|\.\d)/g;
const COMMA_GROUPED_DIGITS_PATTERN = /(?<![\d.,])\d{1,3}(?:,\d{3}){2,}(?![\d.,])/g;

function collapseWhitespace(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function replacePreservingPrefix(text: string, pattern: RegExp, token: string): string {
  return text.replace(pattern, (_match, ...args) => {
    const groups = args[args.length - 1] as { prefix?: string; label?: string } | undefined;
    return `${groups?.prefix ?? groups?.label ?? ''}${token}`;
  });
}

function redactPromoSentences(text: string): string {
  return text
    .split(SENTENCE_SPLIT_PATTERN)
    .map((sentence) =>
      PROMO_EN_PATTERN.test(sentence) || PROMO_AR_PATTERN.test(sentence)
        ? REDACTION_TOKENS.promo
        : sentence
    )
    .join('')
    .replace(/\s*\[PROMO\]\s*/g, ' [PROMO] ');
}

/**
 * Redacts every sensitive category from raw SMS text and returns only safe text.
 * The transaction amount (when present) is preserved. The output is capped in
 * length so a malicious message cannot smuggle content in a huge body.
 */
export function sanitizeSmsText(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    return '';
  }

  let text = raw;
  text = text.replace(URL_PATTERN, REDACTION_TOKENS.url);
  text = text.replace(EMAIL_PATTERN, REDACTION_TOKENS.email);
  text = replacePreservingPrefix(text, OTP_PATTERN, REDACTION_TOKENS.otp);
  text = replacePreservingPrefix(text, OTP_AR_PATTERN, REDACTION_TOKENS.otp);
  text = replacePreservingPrefix(text, REFERENCE_LABELLED_PATTERN, REDACTION_TOKENS.reference);
  text = replacePreservingPrefix(text, REFERENCE_LABELLED_AR_PATTERN, REDACTION_TOKENS.reference);
  text = replacePreservingPrefix(text, ACCOUNT_LABELLED_PATTERN, REDACTION_TOKENS.account);
  text = replacePreservingPrefix(text, ACCOUNT_LABELLED_AR_PATTERN, REDACTION_TOKENS.account);
  text = text.replace(INTL_PHONE_PATTERN, REDACTION_TOKENS.phone);
  text = text.replace(LOCAL_PHONE_PATTERN, REDACTION_TOKENS.phone);
  text = text.replace(GROUPED_PHONE_PATTERN, REDACTION_TOKENS.phone);
  text = text.replace(MASKED_CARD_PATTERN, REDACTION_TOKENS.account);
  text = text.replace(CARD_DIGIT_PATTERN, REDACTION_TOKENS.account);
  text = text.replace(ISO_DATE_PATTERN, REDACTION_TOKENS.date);
  text = text.replace(NUMERIC_DATE_PATTERN, REDACTION_TOKENS.date);
  text = text.replace(DAY_MONTH_DATE_PATTERN, REDACTION_TOKENS.date);
  text = text.replace(MONTH_DAY_DATE_PATTERN, REDACTION_TOKENS.date);
  text = text.replace(ARABIC_DATE_PATTERN, REDACTION_TOKENS.date);
  text = text.replace(SHORT_DATE_PATTERN, REDACTION_TOKENS.date);
  text = text.replace(PERCENT_PATTERN, REDACTION_TOKENS.percent);
  text = replacePreservingPrefix(text, BALANCE_EN_PATTERN, REDACTION_TOKENS.balance);
  text = replacePreservingPrefix(text, BALANCE_AR_PATTERN, REDACTION_TOKENS.balance);
  text = replacePreservingPrefix(text, FEE_EN_PATTERN, REDACTION_TOKENS.fee);
  text = replacePreservingPrefix(text, FEE_AR_PATTERN, REDACTION_TOKENS.fee);
  text = text.replace(COMMA_GROUPED_DIGITS_PATTERN, REDACTION_TOKENS.account);
  text = text.replace(BARE_LONG_DIGITS_PATTERN, REDACTION_TOKENS.account);
  text = redactPromoSentences(text);
  text = collapseWhitespace(text);

  if (text.length > MAX_SANITIZED_LENGTH) {
    text = `${text.slice(0, MAX_SANITIZED_LENGTH - 3).trimEnd()}...`;
  }
  return text;
}

/**
 * Sanitizes free text produced by the fallback model (description fields) with
 * the same redaction rules, so a model hallucination can never reintroduce an
 * OTP, phone number, URL, balance, date, percentage or promo text.
 */
export function sanitizeModelDescription(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const cleaned = sanitizeSmsText(raw);
  return cleaned.length > 0 ? cleaned.slice(0, MAX_DESCRIPTION_LENGTH) : null;
}

/**
 * Sanitizes a merchant name produced by the fallback model: redaction first,
 * then placeholders and punctuation are stripped so the field stays a plain name.
 */
export function sanitizeModelMerchant(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const redacted = sanitizeSmsText(raw)
    .replace(/\[[A-Z]+\]/g, ' ')
    .replace(/[^\p{L}\p{N}\s&./'’-]/gu, ' ');
  const collapsed = collapseWhitespace(redacted);
  return collapsed.length > 0 ? collapsed.slice(0, MAX_MERCHANT_LENGTH) : null;
}

/**
 * Sanitizes the SMS sender for outbound use. Phone-like senders become [PHONE];
 * alphanumeric sender IDs keep their letters but lose embedded digit runs.
 */
export function sanitizeSmsSender(raw: string | null | undefined): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed.length === 0) {
    return REDACTION_TOKENS.unknown;
  }
  if (/^\+?[\d\s().\-]{7,}$/.test(trimmed)) {
    return REDACTION_TOKENS.phone;
  }
  const redacted = trimmed
    .replace(URL_PATTERN, REDACTION_TOKENS.url)
    .replace(EMAIL_PATTERN, REDACTION_TOKENS.email)
    .replace(MASKED_CARD_PATTERN, REDACTION_TOKENS.account)
    .replace(/(?<![\d])\d{6,}(?![\d])/g, REDACTION_TOKENS.account)
    .replace(/(?<![\d])\d[\d\s.\-]{4,}\d(?![\d])/g, REDACTION_TOKENS.phone);
  return collapseWhitespace(redacted).slice(0, MAX_MERCHANT_LENGTH);
}
