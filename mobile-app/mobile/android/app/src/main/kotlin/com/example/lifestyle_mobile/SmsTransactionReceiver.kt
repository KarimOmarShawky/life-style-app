package com.example.lifestyle_mobile

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.media.RingtoneManager
import android.os.Build
import android.provider.Telephony
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

/**
 * Captures wallet and bank transaction SMS and records them in the LifeStyle app.
 *
 * Reliability model:
 *  - The broadcast is handled with goAsync(), so the work is not cut off when onReceive returns.
 *  - Each detected transaction is written to its own SharedPreferences entry
 *    ("pending_wallet_tx.<uuid>") before any network call, so nothing is lost while offline.
 *  - The entry id is sent as the Idempotency-Key, so a retry can never create a duplicate.
 *  - When the app has issued an ingest token (see WalletIngestToken in Flutter), the queue is sent with
 *    it, so capture works while the app is closed. Without one, the stored access token is used, but
 *    only while it is still valid. This receiver never refreshes tokens: the backend revokes the whole
 *    session when a refresh token is reused. Anything still queued is flushed by the Flutter app
 *    (PendingWalletTransactions) on its next start or resume, through ApiClient, which owns refresh.
 */
class SmsTransactionReceiver : BroadcastReceiver() {

    companion object {
        const val TAG = "SmsTransactionReceiver"
        const val CHANNEL_ID = "lifestyle_sms_transactions_channel"
        const val NOTIFICATION_ID = 999

        private const val PREFS_NAME = "FlutterSharedPreferences"
        private const val KEY_SYNC_ENABLED = "flutter.sms_sync_enabled"
        private const val KEY_API_BASE = "flutter.lifestyle.api_base_url"
        private const val INGEST_PATH = "/ingest/transactions"
        private const val ANALYZE_PATH = "/ingest/sms/analyze"
        const val PENDING_PREFIX = "flutter.pending_wallet_tx."
        // Opaque marker: the original stays in its queue (legacy may be plaintext).
        const val REJECTED_TX_PREFIX = "flutter.wallet_tx_rejected."
        const val CANDIDATE_PREFIX = "flutter.pending_wallet_candidate."
        const val REVIEW_PREFIX = "flutter.pending_wallet_review."
        // Non-retryable or unreadable entries are retained here in a sealed
        // envelope until expiry. The diagnostic is not an editable review flow.
        const val QUARANTINE_PREFIX = "flutter.pending_wallet_quarantine."
        // Content-free shared marker: once age/undated hold is observed, a
        // later clock change must not automatically resume that legacy item.
        const val LEGACY_HOLD_PREFIX = "flutter.wallet_legacy_hold."
        // AUD-10: no hard-coded production fallback — the API base must come
        // from SharedPreferences (published by the Flutter app). An unset
        // value skips the native flush instead of sending to a default host.
        private const val CONNECT_TIMEOUT_MS = 8_000
        private const val READ_TIMEOUT_MS = 8_000
        private const val REVIEW_NOTIFICATION_ID = 998
        // Detailed (amount/merchant) notifications are an informed opt-in; the
        // default is a generic prompt (V-03).
        private const val KEY_NOTIFICATION_DETAILS = "flutter.wallet_notification_details"
        // Trusted-sender allow-list (JSON array of normalized phone numbers).
        // Auto-save is only allowed for senders on this list; an empty or absent
        // list means no sender is trusted (AUD-05).
        private const val KEY_TRUSTED_SENDERS = "flutter.wallet_trusted_senders"

        // Candidates are blocked after this many failed analysis attempts.
        private const val MAX_CANDIDATE_ATTEMPTS = 5
        // A quarantined entry is retried this many times before it stays parked
        // for the user to discard (bounded recovery, never an infinite loop).
        private const val MAX_QUARANTINE_ATTEMPTS = 2
        // Quarantine reasons. Only an unreadable payload can heal; a malformed
        // one is proven unparseable and is never restored to its queue.
        private const val QUARANTINE_UNREADABLE = "UNREADABLE"
        private const val QUARANTINE_MALFORMED = "MALFORMED"
        private const val QUARANTINE_REJECTED = "REJECTED"

        // Retryable states back off between attempts instead of hammering the API.
        private const val CANDIDATE_BACKOFF_MS = 5L * 60 * 1000L
        // 503: the fallback provider is absent or down. Retryable, never a
        // semantic "this is not a transaction" (F-02).
        private const val ANALYZE_UNAVAILABLE_STATUS = 503

        // Exhaustive analysis statuses (V-01). The API contract is exactly
        // these three; anything else is a contract violation that must never be
        // treated as "handled" (which deleted the candidate).
        private const val STATUS_RECOGNIZED = "recognized"
        private const val STATUS_UNRECOGNIZED = "unrecognized"
        private const val STATUS_UNAVAILABLE = "unavailable"

        // User-visible state: the fallback could not analyze one or more messages.
        const val KEY_FALLBACK_UNAVAILABLE = "flutter.wallet_sms_fallback_unavailable"
        // User-visible state: entries that cannot be delivered or read.
        const val KEY_QUARANTINE = "flutter.wallet_sms_quarantined"
        // User-visible state: a local write did not reach disk.
        const val KEY_STORAGE_FAULT = "flutter.wallet_storage_fault"

        // Stop automatic retries on these statuses. Transaction uploads retain
        // their existing policy; rejected SMS analyses are parked in quarantine.
        private val PERMANENT_REJECTIONS = setOf(400, 409, 422)

        // One-time passwords are never transactions.
        private val OTP_PATTERN = Regex("""(?i)\botp\b|رمز التحقق|كود التحقق|verification code""")

        // Sender hints for known wallets and banks (matched against the lower-cased sender).
        private val KNOWN_SENDER_HINTS = listOf(
            "instapay", "ipn", "vodafone", "vf-cash", "vfcash", "orange", "etisalat",
            "we pay", "wepay", "fawry", "cib", "nbe", "banque misr", "qnb", "alexbank",
            "adib", "hsbc", "mashreq", "ahly", "ahli", "emirates nbd", "enbd", "faisal",
            "aaib", "bdc", "al baraka", "suez canal"
        )

        // Wallet names that appear in the body even when the sender code is unknown.
        private val WALLET_NAMES = listOf(
            "انستاباي", "فودافون كاش", "اورنج كاش", "اتصالات كاش", "وي باي", "instapay", "vodafone cash"
        )

        // A transaction message must describe a money movement.
        private val MOVEMENT_KEYWORDS = listOf(
            "خصم", "تحويل", "دفع", "سحب", "شراء", "استلام", "إيداع", "سداد", "شحن",
            "debited", "credited", "paid", "received", "deposited", "transferred", "purchase", "withdraw"
        )

        private val INCOME_KEYWORDS = listOf(
            "استلام", "إيداع", "تم تحويل لك", "تم شحن رصيد", "received", "deposited", "credited"
        )

        // Amount candidates, in priority order. A number must be tied to a currency or to a
        // money keyword. Bare numbers (reference numbers, dates, percentages) are never amounts.
        private val AMOUNT_PATTERNS: List<Regex> = listOf(
            // "EGP 500", "LE 500.50", "جنيه 500"
            Regex("""(?i)(?:EGP|LE|جنيه|جم|ج\.م)\s*(\d+(?:\.\d{1,2})?)"""),
            // "500 EGP", "500.00 جنيه", "500 جم"
            Regex("""(?i)(\d+(?:\.\d{1,2})?)\s*(?:EGP|LE|L\.E\.?|جنيه|جم|ج\.م)"""),
            // "مبلغ 500", "قيمة: 500", "amount 500"
            Regex("""(?i)(?:مبلغ|بمبلغ|قيمة|amount)\s*:?\s*(?:EGP|LE|جنيه|جم)?\s*(\d+(?:\.\d{1,2})?)"""),
            // "تم خصم 500", "تحويل 100" (a keyword followed by a number, never a percentage)
            Regex("""(?:خصم|تحويل|سحب|دفع|شراء|استلام|إيداع)\s+(?:مبلغ\s+)?(\d+(?:\.\d{1,2})?)(?![\d.]*\s*%)""")
        )

        // Numbers preceded by these words are balances or references, not the transaction amount.
        private val NON_TRANSACTION_CONTEXT = listOf(
            "رصيد", "متاح", "balance", "available", "مرجع", "reference", "رمز", "otp"
        )
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        // Gate 1: the user must have enabled wallet SMS capture in the app.
        if (!prefs.getBoolean(KEY_SYNC_ENABLED, false)) return
        // Gate 2: the runtime permission must still be granted.
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECEIVE_SMS) != PackageManager.PERMISSION_GRANTED) return

        val messages = try {
            Telephony.Sms.Intents.getMessagesFromIntent(intent)
        } catch (e: Exception) {
            Log.e(TAG, "Could not read the SMS intent", e)
            return
        }
        if (messages.isNullOrEmpty()) return

        val sender = messages[0].displayOriginatingAddress ?: messages[0].originatingAddress ?: "Unknown"
        val body = messages.joinToString(separator = "") { it.displayMessageBody ?: it.messageBody ?: "" }
        val receivedAtMs = messages[0].timestampMillis
        // The body is not logged: it contains financial details.
        Log.d(TAG, "Incoming SMS received")

        // goAsync keeps this receiver alive while the message is parsed, stored and sent.
        val goAsyncHolder = goAsync()
        Thread {
            try {
                val trustedSender = isTrustedSender(context, sender)
                // Do not capture arbitrary messages merely because their body
                // contains payment-like words. Sender labels are a scope filter,
                // not proof of authenticity or account ownership.
                if (!WalletSenderScope.isEligible(sender, trustedSender)) return@Thread
                val transaction = parseSmsTransaction(sender, body)
                if (transaction != null && trustedSender) {
                    // Auto-save only when the sender is on the trusted allow-list.
                    // A body match alone never grants trust: an untrusted sender
                    // goes to the review flow instead (AUD-05).
                    showTransactionNotification(context, transaction)
                    enqueueTransaction(context, transaction, receivedAtMs)
                } else if (looksLikeCandidate(body)) {
                    // A transaction the local parser cannot fully recognize, or a
                    // parsed transaction from an untrusted sender: queue a
                    // sanitized candidate for the backend SMS fallback (Gemini
                    // behind the API). Pattern redaction is not exhaustive.
                    enqueueCandidate(context, sender, body, receivedAtMs)
                }
                flushPending(context)
            } catch (e: Exception) {
                Log.e(TAG, "Error processing incoming SMS", e)
            } finally {
                goAsyncHolder.finish()
            }
        }.start()
    }

    /**
     * A weaker gate than [parseSmsTransaction]: the message talks about a money
     * movement and carries a number, but the strict parser could not fully
     * understand it (for example, an unusual amount format). The caller first
     * checks the sender scope; this body check alone is not sufficient.
     */
    private fun looksLikeCandidate(body: String): Boolean {
        if (OTP_PATTERN.containsMatchIn(body)) return false
        if (!body.any { it.isDigit() }) return false
        val lowerBody = body.lowercase(Locale.ROOT)
        return MOVEMENT_KEYWORDS.any { lowerBody.contains(it) }
    }

    data class DetectedTransaction(
        val amount: String,
        val currency: String,
        val type: String, // "expense" or "income"
        val sender: String,
        val description: String
    )

    /**
     * True only when the sender is on the trusted allow-list stored under
     * [KEY_TRUSTED_SENDERS] (a JSON array of normalized phone numbers or sender IDs). An absent
     * or empty list trusts no sender, so auto-save is off until the user adds one
     * (AUD-05). A malformed list is treated as empty, never as "trust everyone".
     */
    private fun isTrustedSender(context: Context, sender: String): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_TRUSTED_SENDERS, null) ?: return false
        val normalizedSender = WalletSenderScope.normalize(sender)
        if (normalizedSender.isEmpty()) return false
        return try {
            val list = JSONArray(raw)
            for (i in 0 until list.length()) {
                if (WalletSenderScope.normalize(list.optString(i)) == normalizedSender) return true
            }
            false
        } catch (e: Exception) {
            // A malformed allow-list must not silently trust every sender.
            Log.w(TAG, "Wallet trusted-sender list is not valid JSON", e)
            false
        }
    }

    private fun parseSmsTransaction(sender: String, body: String): DetectedTransaction? {
        if (OTP_PATTERN.containsMatchIn(body)) return null

        val lowerSender = sender.lowercase(Locale.ROOT)
        val lowerBody = body.lowercase(Locale.ROOT)
        val normalizedBody = body.replace(",", "")

        val knownSender = KNOWN_SENDER_HINTS.any { lowerSender.contains(it) }
        val walletInBody = WALLET_NAMES.any { lowerBody.contains(it) }
        if (!knownSender && !walletInBody) return null
        if (MOVEMENT_KEYWORDS.none { lowerBody.contains(it) }) return null

        val amount = findAmount(normalizedBody) ?: return null

        val isIncome = INCOME_KEYWORDS.any { lowerBody.contains(it) }
        val type = if (isIncome) "income" else "expense"

        val cleanMerchant = when {
            lowerSender.contains("instapay") || body.contains("انستاباي") -> "InstaPay"
            lowerSender.contains("vodafone") || lowerSender.contains("vfcash") ||
                lowerSender.contains("vf-cash") || body.contains("فودافون") -> "Vodafone Cash"
            lowerSender.contains("orange") || body.contains("اورنج") -> "Orange Money"
            lowerSender.contains("etisalat") || body.contains("اتصالات") -> "Etisalat Cash"
            lowerSender.contains("wepay") || lowerSender.contains("we pay") || body.contains("وي باي") -> "WE Pay"
            lowerSender.contains("fawry") -> "Fawry"
            lowerSender.contains("cib") -> "CIB"
            lowerSender.contains("nbe") || body.contains("الأهلي") -> "NBE Bank"
            lowerSender.contains("misr") || body.contains("بنك مصر") -> "Banque Misr"
            else -> sender
        }

        val typeDesc = if (type == "income") "إيداع / استلام" else "تحويل / دفع"
        val description = "$typeDesc عبر $cleanMerchant"

        return DetectedTransaction(
            amount = amount,
            currency = "EGP",
            type = type,
            sender = cleanMerchant,
            description = description
        )
    }

    /** Returns the earliest plausible amount in the message, formatted with two decimals. */
    private fun findAmount(normalizedBody: String): String? {
        var bestStart = Int.MAX_VALUE
        var bestValue: Double? = null
        for (pattern in AMOUNT_PATTERNS) {
            for (match in pattern.findAll(normalizedBody)) {
                val group = match.groups[1] ?: continue
                val value = group.value.toDoubleOrNull() ?: continue
                if (value <= 0.0) continue
                val start = group.range.first
                val before = normalizedBody.substring(maxOf(0, start - 20), start).lowercase(Locale.ROOT)
                if (NON_TRANSACTION_CONTEXT.any { before.contains(it) }) continue
                if (start < bestStart) {
                    bestStart = start
                    bestValue = value
                }
            }
        }
        val value = bestValue ?: return null
        return String.format(Locale.US, "%.2f", value)
    }

    /**
     * Stores one transaction as its own SharedPreferences entry. commit() (not apply()) writes it to
     * disk before the broadcast can be torn down. occurredOn is the SMS date, so a transaction that is
     * flushed later still lands on the day it happened.
     */
    private fun enqueueTransaction(context: Context, tx: DetectedTransaction, receivedAtMs: Long) {
        val id = UUID.randomUUID().toString()
        val occurredOn = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(receivedAtMs))
        val item = JSONObject()
            .put("id", id)
            .put("kind", tx.type)
            .put("amount", tx.amount)
            .put("currency", tx.currency)
            .put("occurredOn", occurredOn)
            .put("description", tx.description)
            .put("merchant", tx.sender)
            .put("createdAt", System.currentTimeMillis())
        val stored = try {
            WalletQueueCipher().encrypt(item.toString())
        } catch (e: Exception) {
            // No plaintext fallback: an unencrypted queue entry is worse than a
            // loudly logged capture failure. The user still sees the notification.
            Log.e(TAG, "Wallet transaction could not be stored securely", e)
            return
        }
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        // The transaction is only queued once the write reached disk; a failed
        // commit is surfaced instead of being reported as stored (V-02).
        if (!commitEntry(prefs, PENDING_PREFIX + id, stored)) {
            Log.e(TAG, "Wallet transaction did not reach disk")
        }
    }

    /**
     * Sends the queue with the ingest token when one is stored. That token is bound to the login session,
     * so it works while the app is closed. Without it, queued entries remain in SharedPreferences until
     * the Flutter app flushes them via ApiClient (which reads session tokens from SecureTokenStore).
     */
    private fun flushPending(context: Context) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val apiBase = prefs.getString(KEY_API_BASE, null)?.trimEnd('/').orEmpty()
        if (apiBase.isEmpty()) {
            // AUD-10: no production fallback. Leave the queue in place; the
            // Flutter app flushes it once API_BASE_URL is configured.
            Log.w(TAG, "flushPending skipped: API_BASE_URL not configured")
            return
        }

        val ingestToken = WalletCredentialStore(context).read()
        if (!ingestToken.isNullOrEmpty()) {
            flushQueue(context, prefs, "$apiBase$INGEST_PATH", ingestToken, isIngest = true)
            flushCandidates(context, prefs, "$apiBase$ANALYZE_PATH", ingestToken, isIngest = true)
        }
    }

    /**
     * Posts queued entries in order. Only accepted entries are removed; rejected ones stay parked.
     * On any other failure the rest stays queued. A revoked or expired ingest token is removed, so the app
     * issues a new one on its next start.
     */
    private fun flushQueue(context: Context, prefs: SharedPreferences, url: String, token: String, isIngest: Boolean) {
        val cipher = WalletQueueCipher()
        val pendingKeys = prefs.all.keys.filter { it.startsWith(PENDING_PREFIX) }.sorted()
        for (key in pendingKeys) {
            val id = key.removePrefix(PENDING_PREFIX)
            val blockedKey = REJECTED_TX_PREFIX + id
            val holdKey = LEGACY_HOLD_PREFIX + id
            if (prefs.contains(blockedKey) || prefs.contains(holdKey)) continue
            if (prefs.contains(QUARANTINE_PREFIX + id)) {
                // Preserve both records; matching IDs do not prove duplication.
                commitEntry(prefs, holdKey, "HELD")
                continue
            }
            val stored = prefs.getString(key, null) ?: continue
            // v2 entries are Keystore-encrypted; v1 entries migrate as-is.
            val raw = cipher.decrypt(stored)
            if (raw == null) {
                // Unreadable (invalidated key or damaged ciphertext): park it
                // instead of retrying forever or deleting it (V-02).
                quarantine(prefs, key, stored, QUARANTINE_UNREADABLE, PENDING_PREFIX)
                continue
            }
            val itemId = try { JSONObject(raw).opt("id") as? String } catch (_: Exception) { null }
            if (id.isEmpty() || itemId != id) {
                commitEntry(prefs, holdKey, "HELD")
                continue
            }
            if (prefs.contains(blockedKey) || prefs.contains(holdKey) ||
                prefs.contains(QUARANTINE_PREFIX + id)) continue
            val status = postTransaction(url, token, raw)
            if (status in 200..299) {
                // A different runtime may have parked this item during the request.
                if (prefs.contains(blockedKey) || prefs.contains(holdKey) ||
                    prefs.contains(QUARANTINE_PREFIX + id)) continue
                if (!removeEntry(prefs, key)) {
                    Log.e(TAG, "Delivered wallet transaction could not be dequeued")
                }
            } else if (status in PERMANENT_REJECTIONS) {
                // Keep the original, persist a content-free block before continuing.
                if (!commitEntry(prefs, blockedKey, "REJECTED")) return
                publishQuarantineState(prefs, "REJECTED_TRANSACTION")
            } else {
                if (isIngest && (status == 401 || status == 403)) {
                    // Remove only the token that was rejected, in case the app has just replaced it.
                    WalletCredentialStore(context).clear(expected = token)
                }
                // Network, server, or auth problem: keep the rest for a later attempt.
                return
            }
        }
    }

    /** Returns the HTTP status code, or -1 when the request could not be completed. */
    private fun postTransaction(url: String, token: String, rawItem: String): Int {
        return try {
            val item = JSONObject(rawItem)
            val payload = JSONObject()
                .put("kind", item.optString("kind"))
                .put("amount", item.optString("amount"))
                .put("currency", item.optString("currency", "EGP"))
                .put("occurredOn", item.optString("occurredOn"))
            // Absent/null fields stay absent: never send "" placeholders.
            val description = item.optString("description").ifEmpty { null }
            val merchant = item.optString("merchant").ifEmpty { null }
            if (description != null) payload.put("description", description)
            if (merchant != null) payload.put("merchant", merchant)
            val connection = URL(url).openConnection() as HttpURLConnection
            try {
                connection.requestMethod = "POST"
                connection.doOutput = true
                connection.connectTimeout = CONNECT_TIMEOUT_MS
                connection.readTimeout = READ_TIMEOUT_MS
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.setRequestProperty("Authorization", "Bearer $token")
                connection.setRequestProperty("Idempotency-Key", item.optString("id"))
                OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { it.write(payload.toString()) }
                connection.responseCode
            } finally {
                connection.disconnect()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Wallet transaction sync failed", e)
            -1
        }
    }

    /**
     * Stores a pattern-redacted fallback candidate. Unrecognized sensitive
     * content may remain, including in the encrypted queue.
     */
    private fun enqueueCandidate(context: Context, sender: String, body: String, receivedAtMs: Long) {
        val id = UUID.randomUUID().toString()
        val item = JSONObject()
            .put("id", id)
            .put("text", SmsSanitizer.sanitize(body))
            .put("sender", SmsSanitizer.sanitizeSender(sender))
            .put("receivedAtMs", receivedAtMs)
            .put("attempts", 0)
        val stored = try {
            WalletQueueCipher().encrypt(item.toString())
        } catch (e: Exception) {
            Log.e(TAG, "Wallet SMS candidate could not be stored securely", e)
            return
        }
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (!commitEntry(prefs, CANDIDATE_PREFIX + id, stored)) {
            Log.e(TAG, "Wallet SMS candidate did not reach disk")
        }
    }

    /**
     * Asks the backend to analyze queued candidates (the Gemini fallback runs
     * there; the key is server-side only). Every recognized result becomes a
     * review entry the user must confirm in the Money screen; nothing is
     * auto-saved (AUD-05). The candidate id is preserved as the review item id.
     *
     * Result semantics (F-01/F-02):
     *  - 2xx + status "recognized"   -> queue for review, then remove
     *  - 2xx + status "unrecognized" -> final answer, remove
     *  - 503 (or "unavailable")      -> retryable: keep the candidate, back off
     *  - request rejection           -> quarantine, preserving the candidate
     *
     * The candidate is never deleted before its result has been handled.
     */
    private fun flushCandidates(
        context: Context,
        prefs: SharedPreferences,
        analyzeUrl: String,
        token: String,
        isIngest: Boolean
    ) {
        val cipher = WalletQueueCipher()
        retryQuarantined(prefs)
        val candidateKeys = prefs.all.keys.filter { it.startsWith(CANDIDATE_PREFIX) }.sorted()
        for (key in candidateKeys) {
            val id = key.removePrefix(CANDIDATE_PREFIX)
            val holdKey = LEGACY_HOLD_PREFIX + id
            if (prefs.contains(holdKey)) continue
            if (prefs.contains(QUARANTINE_PREFIX + id) || prefs.contains(REVIEW_PREFIX + id)) {
                commitEntry(prefs, holdKey, "HELD")
                continue
            }
            val stored = prefs.getString(key, null) ?: continue
            val raw = cipher.decrypt(stored)
            if (prefs.contains(holdKey)) continue
            if (raw == null) {
                // Unreadable and not proven corrupt: quarantine, never delete (V-02).
                quarantine(prefs, key, stored, QUARANTINE_UNREADABLE, CANDIDATE_PREFIX)
                continue
            }
            val item = try {
                JSONObject(raw)
            } catch (e: Exception) {
                // Malformed content is unrecoverable, but it is still not a
                // reason to lose the message silently: park it for the user.
                if (prefs.contains(holdKey)) continue
                quarantine(prefs, key, stored, QUARANTINE_MALFORMED, CANDIDATE_PREFIX)
                continue
            }
            // Ownership is not authenticated in this legacy queue. Hold old or
            // undated records without deleting, transmitting or modifying them.
            if (WalletLegacyRetention.hold(item.optLong("receivedAtMs", 0L), System.currentTimeMillis())) {
                // A failed commit leaves the source intact but cannot promise
                // the hold will survive restart; commitEntry reports the fault.
                commitEntry(prefs, holdKey, "HELD")
                continue
            }
            if (id.isEmpty() || (item.opt("id") as? String) != id) {
                commitEntry(prefs, holdKey, "HELD")
                continue
            }
            val attempts = item.optInt("attempts", 0)
            if (item.optBoolean("blocked", false)) continue
            if (item.optLong("nextAttemptAtMs", 0L) > System.currentTimeMillis()) continue

            if (prefs.contains(holdKey)) continue
            if (prefs.contains(QUARANTINE_PREFIX + id) || prefs.contains(REVIEW_PREFIX + id)) {
                commitEntry(prefs, holdKey, "HELD")
                continue
            }
            val (status, body) = postAnalyze(analyzeUrl, token, item)
            // Another runtime may have marked the record during the request.
            // The remote call itself cannot be recalled.
            if (prefs.contains(holdKey)) continue
            if (prefs.contains(QUARANTINE_PREFIX + id) || prefs.contains(REVIEW_PREFIX + id)) {
                commitEntry(prefs, holdKey, "HELD")
                continue
            }
            when {
                status in 200..299 && body != null -> {
                    // Handle first, delete after: a recognized result is queued
                    // for review before the candidate disappears (F-01).
                    val outcome = handleAnalysisResult(context, prefs, item, body)
                    if (prefs.contains(holdKey)) continue
                    when (outcome) {
                        CandidateOutcome.HANDLED -> {
                            // Delete only once the replacement record (saved
                            // transaction or review item) is confirmed durable.
                            if (removeEntry(prefs, key)) {
                                // The fallback answered: clear any stalled state.
                                clearFallbackState(prefs)
                            } else {
                                Log.e(TAG, "Handled wallet candidate could not be dequeued")
                            }
                        }
                        CandidateOutcome.RETRY_UNAVAILABLE -> {
                            if (!retryCandidate(prefs, key, item, attempts, RetryReason.UNAVAILABLE)) return
                        }
                        CandidateOutcome.RETRY_UNKNOWN_STATUS -> {
                            if (!retryCandidate(prefs, key, item, attempts, RetryReason.UNKNOWN_STATUS)) return
                        }
                        CandidateOutcome.RETRY_NOT_FINAL -> {
                            if (!retryCandidate(prefs, key, item, attempts, RetryReason.NOT_FINAL)) return
                        }
                        CandidateOutcome.HELD -> continue
                    }
                }
                // The fallback is not configured or is down. This says nothing
                // about the message, so the candidate must survive (F-02).
                status == ANALYZE_UNAVAILABLE_STATUS -> {
                    if (!retryCandidate(prefs, key, item, attempts, RetryReason.UNAVAILABLE)) return
                }
                status in PERMANENT_REJECTIONS -> {
                    // Rejection of an analyze request is not a verdict on the SMS.
                    quarantine(prefs, key, stored, QUARANTINE_REJECTED, CANDIDATE_PREFIX)
                }
                status == 401 || status == 403 -> {
                    if (isIngest) WalletCredentialStore(context).clear(expected = token)
                    return
                }
                else -> {
                    // Network, server, or upstream problem: retry later.
                    if (!retryCandidate(prefs, key, item, attempts, RetryReason.NOT_FINAL)) return
                }
            }
        }
    }

    /**
     * Why a candidate must be kept (V-01/V-02). Every non-final outcome carries
     * its own reason so the retry state and the user-visible diagnostic match
     * what actually happened; none of them delete the candidate.
     */
    private enum class CandidateOutcome {
        HANDLED,
        RETRY_UNAVAILABLE,
        RETRY_UNKNOWN_STATUS,
        RETRY_NOT_FINAL,
        HELD
    }

    /** Why an entry was retried; drives the user-visible diagnostic (V-01). */
    private enum class RetryReason { UNAVAILABLE, NOT_FINAL, UNKNOWN_STATUS }

    /**
     * Applies bounded backoff to one candidate. Returns true when the flush loop
     * can continue with the next candidate, false when this round must stop.
     *
     * Once the attempt budget is spent the candidate is blocked (not deleted)
     * and the matching state is published for the UI, so a stalled fallback or
     * an unexpected status is visible instead of silently losing the message
     * (F-02, V-01).
     */
    private fun retryCandidate(
        prefs: SharedPreferences,
        key: String,
        item: JSONObject,
        attempts: Int,
        reason: RetryReason
    ): Boolean {
        val next = attempts + 1
        if (next >= MAX_CANDIDATE_ATTEMPTS) {
            item.put("attempts", next)
            item.put("blocked", true)
            item.put("retryReason", reason.name)
            if (!writeCandidate(prefs, key, item)) return true
            publishReason(prefs, reason)
            return true
        }
        item.put("attempts", next)
        item.put("retryReason", reason.name)
        item.put("nextAttemptAtMs", System.currentTimeMillis() + CANDIDATE_BACKOFF_MS * next)
        if (!writeCandidate(prefs, key, item)) return true
        if (reason != RetryReason.NOT_FINAL) publishReason(prefs, reason)
        // Backing off: stop this round so a burst of SMS cannot hammer the API.
        return false
    }

    /** Publishes the user-visible state that matches [reason]. */
    private fun publishReason(prefs: SharedPreferences, reason: RetryReason) {
        when (reason) {
            RetryReason.UNAVAILABLE -> publishFallbackUnavailable(prefs)
            RetryReason.UNKNOWN_STATUS -> publishQuarantineState(prefs, "UNKNOWN_STATUS")
            RetryReason.NOT_FINAL -> Unit
        }
    }

    /**
     * Stores one candidate entry. Never writes plaintext (F-05) and reports
     * whether the entry actually reached disk (V-02).
     */
    private fun writeCandidate(prefs: SharedPreferences, key: String, item: JSONObject): Boolean {
        val stored = try {
            WalletQueueCipher().encrypt(item.toString())
        } catch (e: Exception) {
            Log.e(TAG, "Wallet SMS candidate could not be stored securely", e)
            publishStorageFault(prefs)
            return false
        }
        return commitEntry(prefs, key, stored)
    }

    /** Counts how many messages the fallback could not analyze, for the UI. */
    private fun publishFallbackUnavailable(prefs: SharedPreferences) {
        publishCounter(prefs, KEY_FALLBACK_UNAVAILABLE, null)
    }

    /** Counts quarantined entries so the UI can ask the user to resolve them. */
    private fun publishQuarantineState(prefs: SharedPreferences, reason: String) {
        publishCounter(prefs, KEY_QUARANTINE, reason)
    }

    /** Best-effort counter write; a failing diagnostic must never block capture. */
    private fun publishCounter(prefs: SharedPreferences, key: String, reason: String?) {
        val previous = prefs.getString(key, null)
        val count = try {
            if (previous == null) 0 else JSONObject(previous).optInt("count", 0)
        } catch (e: Exception) {
            0
        }
        val state = JSONObject()
            .put("count", count + 1)
            .put("lastAtMs", System.currentTimeMillis())
        if (reason != null) state.put("reason", reason)
        if (!prefs.edit().putString(key, state.toString()).commit()) {
            Log.w(TAG, "Wallet queue diagnostic could not be published")
        }
    }

    /** Publishes a storage fault so a failed write is visible, not silent. */
    private fun publishStorageFault(prefs: SharedPreferences) {
        if (!prefs.edit().putString(KEY_STORAGE_FAULT, System.currentTimeMillis().toString()).commit()) {
            Log.w(TAG, "Wallet storage fault could not be published")
        }
    }

    /** Commits one entry and verifies the write reached disk. */
    private fun commitEntry(prefs: SharedPreferences, key: String, stored: String): Boolean {
        val committed = prefs.edit().putString(key, stored).commit()
        if (!committed) {
            Log.e(TAG, "Wallet queue write did not reach disk")
            publishStorageFault(prefs)
        }
        return committed
    }

    /** Removes one entry and verifies the removal reached disk. */
    private fun removeEntry(prefs: SharedPreferences, key: String): Boolean {
        val removed = prefs.edit().remove(key).commit()
        if (!removed) {
            Log.e(TAG, "Wallet queue removal did not reach disk")
            publishStorageFault(prefs)
        }
        return removed
    }

    /** Clears the stalled-fallback and quarantine counters after a success. */
    private fun clearFallbackState(prefs: SharedPreferences) {
        if (prefs.contains(KEY_FALLBACK_UNAVAILABLE)) {
            prefs.edit().remove(KEY_FALLBACK_UNAVAILABLE).commit()
        }
        if (prefs.contains(KEY_QUARANTINE)) {
            val remaining = prefs.all.keys.count { it.startsWith(QUARANTINE_PREFIX) || it.startsWith(REJECTED_TX_PREFIX) }
            if (remaining == 0) prefs.edit().remove(KEY_QUARANTINE).commit()
        }
    }

    /**
     * Parks one entry instead of retrying it forever or deleting it (V-02).
     * The original (already sealed) value is preserved, so a transient key
     * problem can still be resolved later, and the user sees that something
     * needs attention.
     */
    private fun quarantine(
        prefs: SharedPreferences,
        key: String,
        stored: String,
        reason: String,
        origin: String
    ) {
        val id = key.removePrefix(origin)
        val target = QUARANTINE_PREFIX + id
        val entry = JSONObject()
            .put("origin", origin)
            .put("reason", reason)
            .put("attempts", 0)
            .put("payload", stored)
            .put("quarantinedAtMs", System.currentTimeMillis())
        val sealed = try {
            WalletQueueCipher().encrypt(entry.toString())
        } catch (e: Exception) {
            // The value cannot be re-sealed (Keystore unusable). Leave the
            // original untouched rather than losing data: retry next round.
            Log.e(TAG, "Wallet queue entry could not be quarantined", e)
            publishStorageFault(prefs)
            return
        }
        // A collision is not proof that the two payloads are the same.
        if (prefs.contains(target)) {
            commitEntry(prefs, LEGACY_HOLD_PREFIX + id, "HELD")
            return
        }
        // Write the quarantine record first, then remove the source (V-02).
        if (!commitEntry(prefs, target, sealed)) return
        if (!removeEntry(prefs, key)) {
            // Both copies exist; the duplicate is harmless and the next flush
            // re-reads the source. Never report success without the write.
            Log.e(TAG, "Quarantined wallet entry could not be dequeued")
        }
        publishQuarantineState(prefs, reason)
        Log.w(TAG, "Wallet queue entry quarantined: $reason")
    }

    /**
     * Bounded recovery for quarantined entries: a transient Keystore failure can
     * clear up, and a recovered entry goes back to its origin queue exactly
     * once. Entries beyond the attempt budget stay parked for the user.
     *
     * Only entries quarantined as `UNREADABLE` are candidates for restoration.
     * A `MALFORMED` payload is proven unparseable, so returning it to its queue
     * would loop forever (parse failure -> quarantine -> restore -> parse
     * failure); it stays parked rather than being automatically retried.
     */
    private fun retryQuarantined(prefs: SharedPreferences) {
        val cipher = WalletQueueCipher()
        val keys = prefs.all.keys.filter { it.startsWith(QUARANTINE_PREFIX) }
        if (keys.isEmpty()) return
        for (key in keys) {
            val holdKey = LEGACY_HOLD_PREFIX + key.removePrefix(QUARANTINE_PREFIX)
            if (prefs.contains(holdKey)) continue
            val stored = prefs.getString(key, null) ?: continue
            val raw = cipher.decrypt(stored) ?: continue
            val entry = try {
                JSONObject(raw)
            } catch (e: Exception) {
                continue
            }
            // An old or undated unknown-owner entry must not be deleted or
            // automatically revived into a live queue.
            if (WalletLegacyRetention.hold(entry.optLong("quarantinedAtMs", 0L), System.currentTimeMillis())) {
                commitEntry(prefs, holdKey, "HELD")
                continue
            }
            if (entry.optString("reason") != QUARANTINE_UNREADABLE) continue
            val attempts = entry.optInt("attempts", 0)
            if (attempts >= MAX_QUARANTINE_ATTEMPTS) continue
            val payload = entry.optString("payload")
            val readable = payload.isNotEmpty() && cipher.decrypt(payload) != null
            if (prefs.contains(holdKey)) continue
            if (!readable) {
                entry.put("attempts", attempts + 1)
                val resealed = try {
                    WalletQueueCipher().encrypt(entry.toString())
                } catch (e: Exception) {
                    continue
                }
                if (prefs.contains(holdKey)) continue
                commitEntry(prefs, key, resealed)
                continue
            }
            // Readable again: restore it to its origin queue with a fresh budget.
            val origin = entry.optString("origin")
            if (origin != CANDIDATE_PREFIX && origin != PENDING_PREFIX) continue
            val restored = payload
            val target = origin + key.removePrefix(QUARANTINE_PREFIX)
            if (prefs.contains(holdKey)) continue
            if (prefs.contains(target)) {
                commitEntry(prefs, holdKey, "HELD")
                continue
            }
            if (!commitEntry(prefs, target, restored)) continue
            if (prefs.contains(holdKey)) continue
            if (!removeEntry(prefs, key)) continue
            Log.i(TAG, "Quarantined wallet entry restored")
        }
        if (prefs.all.keys.none { it.startsWith(QUARANTINE_PREFIX) || it.startsWith(REJECTED_TX_PREFIX) }) {
            prefs.edit().remove(KEY_QUARANTINE).commit()
        }
    }

    /**
     * Applies one analyze response and reports whether the candidate may be
     * removed. The API answers with the v1 success envelope
     * `{success, data}`, so the result is read from `data` — reading it from the
     * JSON root silently discarded every recognized candidate (F-01).
     *
     * Status handling is exhaustive (V-01). Only `recognized` (handled above)
     * and `unrecognized` are final answers; `unavailable` is retryable, and any
     * other, missing or non-string status is a contract violation that is
     * retried within the budget and then quarantined. It is never treated as
     * "handled", which previously deleted the candidate.
     */
    private fun handleAnalysisResult(
        context: Context,
        prefs: SharedPreferences,
        candidate: JSONObject,
        body: String
    ): CandidateOutcome {
        val result = unwrapAnalyzeResult(body) ?: return CandidateOutcome.RETRY_NOT_FINAL
        if (!result.has("status") || result.isNull("status")) {
            return CandidateOutcome.RETRY_UNKNOWN_STATUS
        }
        val status = result.opt("status")
        if (status !is String) return CandidateOutcome.RETRY_UNKNOWN_STATUS

        when (status) {
            // The fallback could not run; it says nothing about the message (F-02).
            STATUS_UNAVAILABLE -> return CandidateOutcome.RETRY_UNAVAILABLE
            // A final answer: the message is not a transaction.
            STATUS_UNRECOGNIZED -> return CandidateOutcome.HANDLED
            STATUS_RECOGNIZED -> Unit
            // Unknown/future status: never consume the candidate (V-01).
            else -> {
                Log.w(TAG, "Wallet SMS analysis returned an unrecognized status")
                return CandidateOutcome.RETRY_UNKNOWN_STATUS
            }
        }

        val transaction = result.optJSONObject("transaction")
            ?: return CandidateOutcome.RETRY_NOT_FINAL

        // optString() on a JSON null returns the literal string "null" on Android,
        // so map absent/null/empty description and merchant to null explicitly.
        val description =
            if (transaction.isNull("description")) null
            else transaction.optString("description").ifEmpty { null }
        val merchant =
            if (transaction.isNull("merchant")) null
            else transaction.optString("merchant").ifEmpty { null }

        val reviewItem = JSONObject()
            .put("id", candidate.optString("id"))
            .put("kind", transaction.optString("kind"))
            .put("amount", transaction.optString("amount"))
            .put("currency", transaction.optString("currency", "EGP"))
            .put("occurredOn", transaction.optString("occurredOn"))
            .put("sender", candidate.optString("sender"))
            .put("text", candidate.optString("text"))
            .put("createdAt", System.currentTimeMillis())
        if (description != null) reviewItem.put("description", description)
        if (merchant != null) reviewItem.put("merchant", merchant)

        // Every recognized fallback result requires user confirmation in the Money
        // review flow. Even a "high"-confidence parse is not auto-saved: the
        // fallback model must not write money records without the user reviewing
        // the parse (AUD-05). The candidate id is preserved as the review item id.
        val id = reviewItem.optString("id")
        val stored = try {
            WalletQueueCipher().encrypt(reviewItem.toString())
        } catch (e: Exception) {
            // Without encryption the entry must not be written; keep the
            // candidate so another attempt can still save it.
            Log.e(TAG, "Wallet review item could not be stored securely", e)
            publishStorageFault(prefs)
            return CandidateOutcome.RETRY_NOT_FINAL
        }
        val reviewKey = REVIEW_PREFIX + id
        if (prefs.contains(reviewKey)) {
            commitEntry(prefs, LEGACY_HOLD_PREFIX + id, "HELD")
            return CandidateOutcome.HELD
        }
        // The candidate may only disappear once the review item is on disk (V-02).
        if (!commitEntry(prefs, reviewKey, stored)) return CandidateOutcome.RETRY_NOT_FINAL
        showReviewNotification(context)
        return CandidateOutcome.HANDLED
    }

    /**
     * Accepts the current `{success, data}` envelope and a bare result object,
     * so an older or differently wrapped response cannot be misread as an empty
     * result (F-01).
     */
    internal fun unwrapAnalyzeResult(body: String): JSONObject? {
        val root = try {
            JSONObject(body)
        } catch (e: Exception) {
            return null
        }
        if (root.optBoolean("success", false) && !root.isNull("data")) {
            return root.optJSONObject("data") ?: root
        }
        return root
    }

    /** Returns the HTTP status code and response body for an analyze request. */
    private fun postAnalyze(url: String, token: String, candidate: JSONObject): Pair<Int, String?> {
        return try {
            val payload = JSONObject()
                .put("text", candidate.optString("text"))
                .put("sender", candidate.optString("sender"))
                .put(
                    "receivedAt",
                    SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
                        timeZone = TimeZone.getTimeZone("UTC")
                    }.format(Date(candidate.optLong("receivedAtMs", System.currentTimeMillis())))
                )
            val connection = URL(url).openConnection() as HttpURLConnection
            try {
                connection.requestMethod = "POST"
                connection.doOutput = true
                connection.connectTimeout = CONNECT_TIMEOUT_MS
                connection.readTimeout = READ_TIMEOUT_MS
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.setRequestProperty("Authorization", "Bearer $token")
                OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { it.write(payload.toString()) }
                val code = connection.responseCode
                val stream = if (code in 200..299) connection.inputStream else connection.errorStream
                val body = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
                Pair(code, body)
            } finally {
                connection.disconnect()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Wallet SMS analysis request failed", e)
            Pair(-1, null)
        }
    }

    /**
     * Creates the wallet transaction notification channel if it does not exist
     * yet (AUD-13). Every notify() path must call this first: on Android 8+ a
     * notification posted to a channel that does not exist yet is silently
     * dropped, so the review notification (which never creates the channel
     * itself) would be lost until a direct-parse notification ran.
     */
    private fun ensureNotificationChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager =
            context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "LifeStyle Wallet Transactions",
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "Prompts to review a detected transaction"
            enableVibration(true)
            setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), null)
            // The channel itself never exposes details on the lock screen.
            lockscreenVisibility = NotificationCompat.VISIBILITY_PRIVATE
        }
        manager.createNotificationChannel(channel)
    }

    /** Prompts the user to confirm a pending review item. The item itself is never shown here. */
    private fun showReviewNotification(context: Context) {
        ensureNotificationChannel(context)
        val notificationManager =
            context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val isArabic = Locale.getDefault().language.startsWith("ar")
        val title = if (isArabic) "معاملة تحتاج مراجعة" else "Transaction needs review"
        val text = if (isArabic) {
            "افتح تطبيق LifeStyle للمراجعة قبل الحفظ"
        } else {
            "Open LifeStyle to confirm before it is saved"
        }
        val openAppIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            REVIEW_NOTIFICATION_ID,
            openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notif = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()
        notificationManager.notify(REVIEW_NOTIFICATION_ID, notif)
    }

    /** Parses the UTC ISO-8601 timestamps written by Dart. Sub-second precision is ignored. */
    private fun parseIsoMillis(value: String): Long? {
        if (value.length < 19) return null
        return try {
            val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US)
            format.timeZone = TimeZone.getTimeZone("UTC")
            format.parse(value.substring(0, 19))?.time
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Local notification for a detected transaction (V-03).
     *
     * The raw SMS body is never rendered: it can contain balances,
     * counterparties and references that must not appear on a lock screen or in
     * notification history. The default content is a generic prompt; amount and
     * merchant are only shown when the user opts in
     * (`flutter.wallet_notification_details`). The public (lock-screen) version
     * is always redacted to a generic line, and the notification is marked
     * private so the OS does not expand it outside the unlocked app.
     */
    private fun showTransactionNotification(context: Context, tx: DetectedTransaction) {
        ensureNotificationChannel(context)
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val detailsEnabled = prefs.getBoolean(KEY_NOTIFICATION_DETAILS, false)

        val openAppIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("route", "/money")
        }

        val pendingIntent = PendingIntent.getActivity(
            context,
            NOTIFICATION_ID,
            openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val isArabic = Locale.getDefault().language.startsWith("ar")
        val title = if (isArabic) "معاملة جديدة تحتاج مراجعة" else "New transaction to review"
        val genericText = if (isArabic) {
            "افتح تطبيق LifeStyle للمراجعة والحفظ"
        } else {
            "Open LifeStyle to review and save it"
        }
        val detailText = if (detailsEnabled) {
            val typeLabel = if (tx.type == "income") {
                if (isArabic) "إيداع +" else "Income +"
            } else {
                if (isArabic) "خصم -" else "Expense -"
            }
            "$genericText · $typeLabel ${tx.amount} ${tx.currency}"
        } else {
            genericText
        }

        // Redacted public version: shown on a locked device when the OS allows it.
        val publicVersion = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(if (isArabic) "LifeStyle" else "LifeStyle")
            .setContentText(if (isArabic) "لديك عنصر بانتظار المراجعة" else "You have an item to review")
            .build()

        val notif = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(detailText)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        manager.notify(NOTIFICATION_ID, notif)
    }
}
