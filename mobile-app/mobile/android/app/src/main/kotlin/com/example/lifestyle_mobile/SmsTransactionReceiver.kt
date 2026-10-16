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
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URI
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
        const val CANDIDATE_PREFIX = "flutter.pending_wallet_candidate."
        const val REVIEW_PREFIX = "flutter.pending_wallet_review."
        private const val DEFAULT_API_BASE = "https://life-style-app-production.up.railway.app/api/v1"
        private const val CONNECT_TIMEOUT_MS = 8_000
        private const val READ_TIMEOUT_MS = 8_000
        private const val REVIEW_NOTIFICATION_ID = 998

        // Candidates are dropped after this many failed delivery attempts.
        private const val MAX_CANDIDATE_ATTEMPTS = 5

        // 400 and 422: the payload is invalid. 409: the idempotency key was reused with other data.
        // Retrying cannot succeed for these, so the queued entry is dropped.
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
                val transaction = parseSmsTransaction(sender, body)
                if (transaction != null) {
                    showTransactionNotification(context, transaction)
                    enqueueTransaction(context, transaction, receivedAtMs)
                } else if (looksLikeCandidate(body)) {
                    // Likely transaction the local parser cannot recognize: queue a
                    // sanitized candidate for the backend SMS fallback (Gemini behind
                    // the API). The raw text never leaves the phone.
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
     * understand it (unknown sender, unusual amount format, ...). Only these are
     * worth a fallback call.
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
        val description: String,
        val rawMessage: String
    )

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
            description = description,
            rawMessage = body
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
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(PENDING_PREFIX + id, item.toString())
            .commit()
    }

    private fun isTrustedApiBase(rawUrl: String): Boolean {
        return try {
            val uri = URI(rawUrl)
            val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return false
            val host = uri.host?.lowercase(Locale.ROOT) ?: return false
            if (scheme == "https") return host.isNotEmpty()
            scheme == "http" && (host == "localhost" || host == "127.0.0.1" || host == "10.0.2.2")
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Sends the queue with the ingest token when one is stored. That token is bound to the login session,
     * so it works while the app is closed. Without it, queued entries remain in SharedPreferences until
     * the Flutter app flushes them via ApiClient (which reads session tokens from SecureTokenStore).
     */
    private fun flushPending(context: Context) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val configuredBase = prefs.getString(KEY_API_BASE, null)?.trim()?.trimEnd('/')
        val apiBase = if (!configuredBase.isNullOrEmpty() && isTrustedApiBase(configuredBase)) {
            configuredBase
        } else {
            DEFAULT_API_BASE
        }

        val ingestToken = WalletCredentialStore(context).read()
        if (!ingestToken.isNullOrEmpty()) {
            flushQueue(context, prefs, "$apiBase$INGEST_PATH", ingestToken, isIngest = true)
            flushCandidates(context, prefs, "$apiBase$ANALYZE_PATH", "$apiBase$INGEST_PATH", ingestToken, isIngest = true)
        }
    }

    /**
     * Posts queued entries in order. An entry is removed when the backend accepts it or rejects it for good.
     * On any other failure the rest stays queued. A revoked or expired ingest token is removed, so the app
     * issues a new one on its next start.
     */
    private fun flushQueue(context: Context, prefs: SharedPreferences, url: String, token: String, isIngest: Boolean) {
        val pendingKeys = prefs.all.keys.filter { it.startsWith(PENDING_PREFIX) }.sorted()
        for (key in pendingKeys) {
            val raw = prefs.getString(key, null) ?: continue
            val status = postTransaction(url, token, raw)
            if (status in 200..299 || status in PERMANENT_REJECTIONS) {
                prefs.edit().remove(key).commit()
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
     * Stores one fallback candidate: sanitized text only, so a queued entry never
     * contains raw financial identifiers even on disk beyond what the parser kept.
     */
    private fun enqueueCandidate(context: Context, sender: String, body: String, receivedAtMs: Long) {
        val id = UUID.randomUUID().toString()
        val item = JSONObject()
            .put("id", id)
            .put("text", SmsSanitizer.sanitize(body))
            .put("sender", SmsSanitizer.sanitizeSender(sender))
            .put("receivedAtMs", receivedAtMs)
            .put("attempts", 0)
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(CANDIDATE_PREFIX + id, item.toString())
            .commit()
    }

    /**
     * Asks the backend to analyze queued candidates (the Gemini fallback runs
     * there; the key is server-side only). A high-confidence parse is saved at
     * once with the candidate id as the Idempotency-Key, so retries can never
     * duplicate it. A low-confidence parse becomes a review entry the user must
     * confirm in the Money screen. Anything unrecognized is dropped.
     */
    private fun flushCandidates(
        context: Context,
        prefs: SharedPreferences,
        analyzeUrl: String,
        saveUrl: String,
        token: String,
        isIngest: Boolean
    ) {
        val candidateKeys = prefs.all.keys.filter { it.startsWith(CANDIDATE_PREFIX) }.sorted()
        for (key in candidateKeys) {
            val raw = prefs.getString(key, null) ?: continue
            val item = try {
                JSONObject(raw)
            } catch (e: Exception) {
                prefs.edit().remove(key).commit()
                continue
            }
            val attempts = item.optInt("attempts", 0)
            if (attempts >= MAX_CANDIDATE_ATTEMPTS) {
                prefs.edit().remove(key).commit()
                continue
            }

            val (status, body) = postAnalyze(analyzeUrl, token, item)
            when {
                status in 200..299 && body != null -> {
                    prefs.edit().remove(key).commit()
                    handleAnalysisResult(context, prefs, saveUrl, token, item, body)
                }
                status in PERMANENT_REJECTIONS -> {
                    prefs.edit().remove(key).commit()
                }
                status == 401 || status == 403 -> {
                    if (isIngest) WalletCredentialStore(context).clear(expected = token)
                    return
                }
                else -> {
                    // Network, server, or upstream problem: retry later.
                    item.put("attempts", attempts + 1)
                    prefs.edit().putString(key, item.toString()).commit()
                    return
                }
            }
        }
    }

    /** Applies one analyze response: auto-save, queue for review, or drop. */
    private fun handleAnalysisResult(
        context: Context,
        prefs: SharedPreferences,
        saveUrl: String,
        token: String,
        candidate: JSONObject,
        body: String
    ) {
        val result = try {
            JSONObject(body)
        } catch (e: Exception) {
            return
        }
        val status = result.optString("status")
        val transaction = result.optJSONObject("transaction")
        val confidence = result.optString("confidence")
        if (status != "recognized" || transaction == null) {
            // "unrecognized" or "unavailable": not a transaction we can log.
            return
        }

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

        if (confidence == "high") {
            // High confidence may auto-save. The candidate id is the Idempotency-Key.
            val saveItem = JSONObject()
                .put("id", candidate.optString("id"))
                .put("kind", reviewItem.optString("kind"))
                .put("amount", reviewItem.optString("amount"))
                .put("currency", reviewItem.optString("currency"))
                .put("occurredOn", reviewItem.optString("occurredOn"))
            if (description != null) saveItem.put("description", description)
            if (merchant != null) saveItem.put("merchant", merchant)
            val saved = postTransaction(saveUrl, token, saveItem.toString())
            if (saved in 200..299 || saved in PERMANENT_REJECTIONS) {
                return
            }
            // Could not save now: keep it as a review entry so nothing is lost.
        }

        // Low confidence requires user confirmation in the Money review flow.
        val id = reviewItem.optString("id")
        prefs.edit().putString(REVIEW_PREFIX + id, reviewItem.toString()).commit()
        showReviewNotification(context)
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

    /** Prompts the user to confirm a pending review item. The item itself is never shown here. */
    private fun showReviewNotification(context: Context) {
        val notificationManager =
            context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val isArabic = Locale.getDefault().language.startsWith("ar")
        val title = if (isArabic) "معاملة تحتاج مراجعة" else "Transaction needs review"
        val text = if (isArabic) {
            "افتح تطبيق LifeStyle للمراجعة قبل الحفظ"
        } else {
            "Open LifeStyle to confirm before it is saved"
        }
        val notif = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
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

    private fun showTransactionNotification(context: Context, tx: DetectedTransaction) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "LifeStyle Wallet Transactions",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Automatic notifications for InstaPay and Wallet transactions"
                enableVibration(true)
                setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), null)
            }
            manager.createNotificationChannel(channel)
        }

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
        val title = if (isArabic) "تم رصد معاملة جديدة (${tx.sender})" else "New Transaction Detected (${tx.sender})"
        val typeLabel = if (tx.type == "income") {
            if (isArabic) "إيداع +" else "Income +"
        } else {
            if (isArabic) "خصم -" else "Expense -"
        }

        val text = "$typeLabel ${tx.amount} ${tx.currency} • ${tx.sender}"

        val notif = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        manager.notify(NOTIFICATION_ID, notif)
    }
}
