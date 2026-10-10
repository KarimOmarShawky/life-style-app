package com.example.lifestyle_mobile

/**
 * On-device redaction for SMS text that is queued for the backend SMS fallback.
 *
 * The local parser auto-saves only transactions it fully understands. Anything
 * else that still looks like a money movement is queued as a *candidate* and
 * analyzed by the backend (Gemini behind the API). Before a candidate leaves the
 * phone it is sanitized here, and the backend sanitizes it again ("re-sanitize").
 * Raw SMS text is never sent anywhere and never written to logs.
 *
 * Redacted categories (stable placeholders, same as the backend sanitizer):
 * - OTP / verification codes                      -> [OTP]
 * - phone, account, card and reference numbers    -> [PHONE] / [ACCOUNT] / [REFERENCE]
 * - URLs and email addresses                      -> [URL] / [EMAIL]
 * - balance and fee details                       -> [BALANCE] / [FEE]
 * - dates                                         -> [DATE]
 * - percentages                                   -> [PERCENT]
 * - promotional text                              -> [PROMO]
 *
 * The transaction amount (a number tied to a currency or money keyword) is kept
 * so the analyzer can extract it. Bare runs of 7+ digits are treated as
 * references and redacted: over-redaction only lowers confidence, while
 * under-redaction leaks financial identifiers.
 */
object SmsSanitizer {
    private const val MAX_LENGTH = 600

    private val URL_PATTERN = Regex("""(?i)\b(?:https?://\S+|www\.\S+)""")
    private val EMAIL_PATTERN = Regex("""\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b""")
    private val MASKED_CARD_PATTERN = Regex("""\*{2,}[\d* -]{2,}?\d""")

    private val OTP_PATTERN = Regex(
        """(?i)(?<label>\b(?:otp|one[\s-]?time\s+(?:password|code|pin)|verification\s+code|pin\s+code|كود التحقق|رمز التحقق|الرمز السري|كلمة المرور)\b[\s:=\-]*(?:is[\s:=\-]+|هو[\s:=\-]+)?)(?<code>\d{4,8}(?!\d)|[A-Z0-9]{6,8}(?![\p{L}\p{N}_]))"""
    )

    private val REFERENCE_LABELLED_PATTERN = Regex(
        """(?i)(?<label>\b(?:ref(?:erence)?(?:\s+(?:no|number|code))?|transaction\s+(?:id|no|number)|txn\s*(?:id|no)?|trace|رقم المرجع|المرجع|رقم العملية)\b[\s:=\-]*)(?<digits>\*{0,4}[\d*][\d* -]{1,}[\d*])"""
    )
    private val ACCOUNT_LABELLED_PATTERN = Regex(
        """(?i)(?<label>\b(?:account|acc|a/c|acct|iban|card(?:\s+(?:no|number))?|رقم الحساب|الحساب|رقم البطاقة)\b[\s:=\-]*)(?<digits>\*{0,4}[\d*][\d* -]{1,}[\d*])"""
    )

    // A trailing "." is a sentence period unless a digit follows (then it is a decimal).
    private val INTL_PHONE_PATTERN = Regex("""(?<![\dA-Za-z])\+(?:\d[\s.-]?){7,15}\d(?!\d|\.\d)""")
    private val LOCAL_PHONE_PATTERN = Regex("""(?<![\d.])0\d{9,14}(?!\d|\.\d)""")
    private val GROUPED_PHONE_PATTERN = Regex("""(?<![\d.])\d{3}[\s.-]\d{3}[\s.-]\d{3,4}(?!\d|\.\d)""")

    private val ISO_DATE_PATTERN = Regex("""(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)""")
    private val NUMERIC_DATE_PATTERN = Regex("""(?<![\d.])\d{1,2}[/.]\d{1,2}[/.]\d{2,4}(?!\d)""")
    private val SHORT_DATE_PATTERN = Regex("""(?<![\d.\-/])\d{1,2}[/-]\d{1,2}(?![\d\-/]|%|\.\d)""")
    private val ARABIC_DATE_PATTERN = Regex(
        """\d{1,2}\s*(?:يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)"""
    )

    private val PERCENT_PATTERN = Regex("""(?<![\d.])\d+(?:\.\d+)?\s*(?:%|بالمائة|بالمئة|في المئة|percent)""")

    private val CURRENCY_SUFFIX = """(?:\s*(?:egp|usd|eur|gbp|aed|sar|le|l\.e\.?|جنيه|ج\.م|جم|درهم|ريال))?"""
    private val AMOUNT_TAIL = """\d[\d.,]*$CURRENCY_SUFFIX"""

    private val BALANCE_PATTERN = Regex(
        """(?i)(?<prefix>(?<![\p{L}\p{N}_])(?:available\s+balance|current\s+balance|closing\s+balance|balance|bal|الرصيد\s+المتاح|رصيدك|الرصيد|المتاح|متاح|متوفر)(?![\p{L}\p{N}_])[\s:=(\-]*)(?<amount>$AMOUNT_TAIL)"""
    )
    private val FEE_PATTERN = Regex(
        """(?i)(?<prefix>(?<![\p{L}\p{N}_])(?:fees?|charges?|commission|رسوم|عمولة|مصاريف)(?![\p{L}\p{N}_])[\s:=(\-]*(?:of|:)?[\s]*)(?<amount>$AMOUNT_TAIL)"""
    )

    // Promotional sentences are dropped whole. Bare "خصم" is NOT a cue: it is a
    // debit keyword ("charged 500") and must survive.
    private val PROMO_PATTERN = Regex(
        """(?i)\b(?:for more (?:info|information|details)|to (?:know|get|see) more|visit (?:our|us|www)|call (?:us|customer care|customer service)|customer (?:care|service)|hotline|toll[ -]?free|terms (?:and|&) conditions|message and data rates|unsubscribe|opt out|promo(?: code)?|use code|special offer|limited time|voucher|download (?:our|the) app)"""
    )
    private val PROMO_AR_PATTERN = Regex(
        """(?<![\p{L}\p{N}_])(?:اشحن رصيدك|اشحن|اشترك|للمزيد|خدمة العملاء|اتصل بنا|الخط الساخن|عرض (?:خاص|اليوم|مميز)|خصم (?:خاص|مميز)|توصيل مجان[يا]|حمل(?:وا)? التطبيق|تابعونا|زور[وا]|الغاء الاشتراك|استمتع بخصم)(?![\p{L}\p{N}_])"""
    )
    private val SENTENCE_SPLIT_PATTERN = Regex("""(?<=[.!?\u061F\n\u061B])""")

    private val BARE_LONG_DIGITS_PATTERN = Regex("""(?<![\d.,])\d{7,}(?!\d|\.\d)""")
    private val COMMA_GROUPED_DIGITS_PATTERN = Regex("""(?<![\d.,])\d{1,3}(?:,\d{3}){2,}(?![\d.,])""")

    /** Redacts every sensitive category and returns only safe text. */
    @JvmStatic
    fun sanitize(raw: String): String {
        if (raw.isEmpty()) return ""
        var text = raw
        text = text.replace(URL_PATTERN, "[URL]")
        text = text.replace(EMAIL_PATTERN, "[EMAIL]")
        text = replaceKeepingLabel(text, OTP_PATTERN, "[OTP]")
        text = replaceKeepingLabel(text, REFERENCE_LABELLED_PATTERN, "[REFERENCE]")
        text = replaceKeepingLabel(text, ACCOUNT_LABELLED_PATTERN, "[ACCOUNT]")
        text = text.replace(INTL_PHONE_PATTERN, "[PHONE]")
        text = text.replace(LOCAL_PHONE_PATTERN, "[PHONE]")
        text = text.replace(GROUPED_PHONE_PATTERN, "[PHONE]")
        text = text.replace(MASKED_CARD_PATTERN, "[ACCOUNT]")
        text = text.replace(ISO_DATE_PATTERN, "[DATE]")
        text = text.replace(NUMERIC_DATE_PATTERN, "[DATE]")
        text = text.replace(SHORT_DATE_PATTERN, "[DATE]")
        text = text.replace(ARABIC_DATE_PATTERN, "[DATE]")
        text = text.replace(PERCENT_PATTERN, "[PERCENT]")
        text = replaceKeepingLabel(text, BALANCE_PATTERN, "[BALANCE]")
        text = replaceKeepingLabel(text, FEE_PATTERN, "[FEE]")
        text = text.replace(COMMA_GROUPED_DIGITS_PATTERN, "[ACCOUNT]")
        text = text.replace(BARE_LONG_DIGITS_PATTERN, "[ACCOUNT]")
        text = redactPromoSentences(text)
        text = text.replace(Regex("""[ \t]{2,}"""), " ").trim()
        return if (text.length > MAX_LENGTH) text.substring(0, MAX_LENGTH - 3).trimEnd() + "..." else text
    }

    /** Sanitizes the sender for outbound use. Phone-like senders become [PHONE]. */
    @JvmStatic
    fun sanitizeSender(raw: String?): String {
        val trimmed = raw?.trim() ?: ""
        if (trimmed.isEmpty()) return "[UNKNOWN]"
        if (Regex("""^\+?[\d\s().\-]{7,}$""").matches(trimmed)) return "[PHONE]"
        val redacted = trimmed
            .replace(URL_PATTERN, "[URL]")
            .replace(EMAIL_PATTERN, "[EMAIL]")
            .replace(Regex("""(?<!\d)\d{6,}(?!\d)"""), "[ACCOUNT]")
            .replace(Regex("""(?<!\d)\d[\d\s.\-]{4,}\d(?!\d)"""), "[PHONE]")
        return redacted.replace(Regex("""[ \t]{2,}"""), " ").trim().take(60)
    }

    private fun replaceKeepingLabel(text: String, pattern: Regex, token: String): String {
        return pattern.replace(text) { match ->
            val named = match.groups as? MatchNamedGroupCollection
            val label = named?.get("label")?.value ?: named?.get("prefix")?.value ?: ""
            label + token
        }
    }

    private fun redactPromoSentences(text: String): String {
        return text.split(SENTENCE_SPLIT_PATTERN)
            .joinToString("") { sentence ->
                if (PROMO_PATTERN.containsMatchIn(sentence) || PROMO_AR_PATTERN.containsMatchIn(sentence)) {
                    "[PROMO]"
                } else {
                    sentence
                }
            }
            .replace(Regex("""\s*\[PROMO\]\s*"""), " [PROMO] ")
    }
}
