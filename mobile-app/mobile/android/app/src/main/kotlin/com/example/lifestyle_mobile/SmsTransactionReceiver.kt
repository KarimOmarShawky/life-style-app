package com.example.lifestyle_mobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.RingtoneManager
import android.os.Build
import android.provider.Telephony
import android.util.Log
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.regex.Pattern

class SmsTransactionReceiver : BroadcastReceiver() {

    companion object {
        const val TAG = "SmsTransactionReceiver"
        const val CHANNEL_ID = "lifestyle_sms_transactions_channel"
        const val NOTIFICATION_ID = 999
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        try {
            val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
            if (messages.isNullOrEmpty()) return

            val fullBody = StringBuilder()
            var sender = ""

            for (sms in messages) {
                sender = sms.displayOriginatingAddress ?: sms.originatingAddress ?: "Unknown"
                fullBody.append(sms.displayMessageBody ?: sms.messageBody ?: "")
            }

            val body = fullBody.toString()
            Log.d(TAG, "Received SMS from: $sender, content: $body")

            // Parse transaction details
            val transaction = parseSmsTransaction(sender, body) ?: return

            // 1. Show notification to user
            showTransactionNotification(context, transaction)

            // 2. Synchronize transaction to backend
            Thread {
                syncTransactionToBackend(context, transaction)
            }.start()

        } catch (e: Exception) {
            Log.e(TAG, "Error processing incoming SMS", e)
        }
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
        val lowerSender = sender.lowercase(Locale.ROOT)
        val normalizedBody = body.replace(",", "")

        // Check if message is related to wallets or banking in Egypt
        val isWalletOrBank = lowerSender.contains("instapay") ||
                lowerSender.contains("ipn") ||
                lowerSender.contains("vodafone") ||
                lowerSender.contains("vf-cash") ||
                lowerSender.contains("vfcash") ||
                lowerSender.contains("orange") ||
                lowerSender.contains("etisalat") ||
                lowerSender.contains("we pay") ||
                lowerSender.contains("wepay") ||
                lowerSender.contains("fawry") ||
                lowerSender.contains("cib") ||
                lowerSender.contains("nbe") ||
                lowerSender.contains("banque misr") ||
                lowerSender.contains("qnb") ||
                lowerSender.contains("alexbank") ||
                body.contains("انستاباي") ||
                body.contains("فودافون كاش") ||
                body.contains("اورنج كاش") ||
                body.contains("اتصالات كاش") ||
                body.contains("وي باي") ||
                body.contains("محفظة") ||
                body.contains("تحويل") ||
                body.contains("خصم") ||
                body.contains("شراء") ||
                body.contains("إيداع") ||
                body.contains("استلام")

        if (!isWalletOrBank) return null

        // Detect Amount (handles 500, 500.50, 1000 EGP, 500 جم, 500 جنيه)
        val amountPattern = Pattern.compile("(?:مبلغ|قيمة|بمبلغ|خصم|تحويل|إيداع|استلام)?\\s*(\\d+(?:\\.\\d{1,2})?)\\s*(?:جم|جنيه|ج\\.م|EGP|LE|egp)?", Pattern.CASE_INSENSITIVE)
        val matcher = amountPattern.matcher(normalizedBody)

        var amount: String? = null
        while (matcher.find()) {
            val candidate = matcher.group(1)
            val num = candidate?.toDoubleOrNull()
            if (num != null && num > 0) {
                amount = String.format(Locale.US, "%.2f", num)
                break
            }
        }

        if (amount == null) return null

        // Determine Type (Expense vs Income)
        val isIncome = body.contains("استلام") ||
                body.contains("إيداع") ||
                body.contains("تم تحويل لك") ||
                body.contains("تم شحن رصيد") ||
                body.contains("تحويل من") ||
                body.contains("received") ||
                body.contains("deposited") ||
                body.contains("credited")

        val type = if (isIncome) "income" else "expense"

        // Determine Clean Merchant/Source
        val cleanMerchant = when {
            lowerSender.contains("instapay") || body.contains("انستاباي") -> "InstaPay"
            lowerSender.contains("vodafone") || lowerSender.contains("vf") || body.contains("فودافون") -> "Vodafone Cash"
            lowerSender.contains("orange") || body.contains("اورنج") -> "Orange Money"
            lowerSender.contains("etisalat") || body.contains("اتصالات") -> "Etisalat Cash"
            lowerSender.contains("we") || body.contains("وي باي") -> "WE Pay"
            lowerSender.contains("fawry") || body.contains("فوري") -> "Fawry"
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
            .setStyle(NotificationCompat.BigTextStyle().bigText("$text\n${tx.rawMessage}"))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        manager.notify(NOTIFICATION_ID, notif)
    }

    private fun syncTransactionToBackend(context: Context, tx: DetectedTransaction) {
        try {
            val prefs = context.getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)
            val sessionJsonStr = prefs.getString("flutter.lifestyle.session.v1", null) ?: return
            val sessionJson = JSONObject(sessionJsonStr)
            val accessToken = sessionJson.optString("accessToken", "")
            if (accessToken.isEmpty()) return

            val url = URL("https://life-style-app-production.up.railway.app/api/v1/money/transactions")
            val uuid = java.util.UUID.randomUUID().toString()
            val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.US)
            val todayStr = sdf.format(Date())

            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Authorization", "Bearer $accessToken")
                setRequestProperty("Idempotency-Key", uuid)
                doOutput = true
                connectTimeout = 8000
                readTimeout = 8000
            }

            val body = JSONObject().apply {
                put("kind", tx.type)
                put("amount", tx.amount)
                put("currency", "EGP")
                put("occurredOn", todayStr)
                put("description", tx.description)
                put("merchant", tx.sender)
            }

            OutputStreamWriter(conn.outputStream).use { it.write(body.toString()) }
            val code = conn.responseCode
            Log.d(TAG, "Transaction synced to backend: response code $code")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to sync transaction to backend", e)
        }
    }
}
