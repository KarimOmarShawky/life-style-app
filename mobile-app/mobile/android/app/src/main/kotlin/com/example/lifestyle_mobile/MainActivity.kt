package com.example.lifestyle_mobile

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.speech.RecognizerIntent
import java.util.Locale
import java.util.regex.Pattern
import androidx.core.app.NotificationCompat
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val CHANNEL = "com.example.lifestyle_mobile/native_voice"
    private val SMS_CHANNEL = "com.example.lifestyle_mobile/sms_wallets"
    private val REQUEST_SPEECH = 202
    private val REQUEST_SMS_PERM = 203
    private var pendingVoiceResult: MethodChannel.Result? = null
    private var pendingSmsResult: MethodChannel.Result? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 101)
        }
        showNativePinnedNotification(this)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        // Voice Channel
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "refreshPinnedNotification" -> {
                    showNativePinnedNotification(this)
                    result.success(true)
                }
                "startVoiceRecognition" -> {
                    pendingVoiceResult = result
                    try {
                        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                            putExtra(
                                RecognizerIntent.EXTRA_PROMPT,
                                if (Locale.getDefault().language.startsWith("ar")) "تحدث بمهمتك الآن..." else "Speak your task now..."
                            )
                        }
                        startActivityForResult(intent, REQUEST_SPEECH)
                    } catch (e: Exception) {
                        pendingVoiceResult?.error("SPEECH_NOT_AVAILABLE", e.message, null)
                        pendingVoiceResult = null
                    }
                }
                else -> result.notImplemented()
            }
        }

        // SMS Wallets Channel
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, SMS_CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "requestSmsPermission" -> {
                    val hasPerm = checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED &&
                            checkSelfPermission(Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED
                    if (!hasPerm) {
                        pendingSmsResult = result
                        requestPermissions(arrayOf(Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS), REQUEST_SMS_PERM)
                    } else {
                        result.success(true)
                    }
                }
                "scanRecentWalletSms" -> {
                    result.success(scanRecentWalletSms())
                }
                else -> result.notImplemented()
            }
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_SPEECH) {
            if (resultCode == Activity.RESULT_OK && data != null) {
                val results = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
                val spokenText = results?.firstOrNull() ?: ""
                pendingVoiceResult?.success(spokenText)
            } else {
                pendingVoiceResult?.success("")
            }
            pendingVoiceResult = null
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_SMS_PERM) {
            val granted = grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }
            pendingSmsResult?.success(granted)
            pendingSmsResult = null
        }
    }

    private fun scanRecentWalletSms(): List<Map<String, Any>> {
        val list = mutableListOf<Map<String, Any>>()
        if (checkSelfPermission(Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) {
            return list
        }

        try {
            val uri = Uri.parse("content://sms/inbox")
            val projection = arrayOf("address", "body", "date")
            val cursor = contentResolver.query(uri, projection, null, null, "date DESC LIMIT 50")

            cursor?.use {
                val addressIdx = it.getColumnIndex("address")
                val bodyIdx = it.getColumnIndex("body")
                val dateIdx = it.getColumnIndex("date")

                val amountPattern = Pattern.compile("(?:مبلغ|قيمة|بمبلغ|خصم|تحويل|إيداع|استلام)?\\s*(\\d+(?:\\.\\d{1,2})?)\\s*(?:جم|جنيه|ج\\.م|EGP|LE|egp)?", Pattern.CASE_INSENSITIVE)

                while (it.moveToNext()) {
                    val address = it.getString(addressIdx) ?: ""
                    val body = it.getString(bodyIdx) ?: ""
                    val dateLong = it.getLong(dateIdx)

                    val lowerAddress = address.lowercase(Locale.ROOT)
                    val isWalletOrBank = lowerAddress.contains("instapay") ||
                            lowerAddress.contains("ipn") ||
                            lowerAddress.contains("vodafone") ||
                            lowerAddress.contains("vf") ||
                            lowerAddress.contains("orange") ||
                            lowerAddress.contains("etisalat") ||
                            lowerAddress.contains("we") ||
                            lowerAddress.contains("fawry") ||
                            lowerAddress.contains("cib") ||
                            lowerAddress.contains("nbe") ||
                            lowerAddress.contains("misr") ||
                            body.contains("انستاباي") ||
                            body.contains("فودافون كاش") ||
                            body.contains("اورنج كاش") ||
                            body.contains("اتصالات كاش") ||
                            body.contains("وي باي") ||
                            body.contains("تحويل") ||
                            body.contains("خصم")

                    if (!isWalletOrBank) continue

                    val matcher = amountPattern.matcher(body.replace(",", ""))
                    var amount = ""
                    while (matcher.find()) {
                        val num = matcher.group(1)?.toDoubleOrNull()
                        if (num != null && num > 0) {
                            amount = String.format(Locale.US, "%.2f", num)
                            break
                        }
                    }
                    if (amount.isEmpty()) continue

                    val isIncome = body.contains("استلام") || body.contains("إيداع") || body.contains("تم تحويل لك")
                    val type = if (isIncome) "income" else "expense"

                    val cleanSender = when {
                        lowerAddress.contains("instapay") || body.contains("انستاباي") -> "InstaPay"
                        lowerAddress.contains("vodafone") || lowerAddress.contains("vf") || body.contains("فودافون") -> "Vodafone Cash"
                        lowerAddress.contains("orange") || body.contains("اورنج") -> "Orange Money"
                        lowerAddress.contains("etisalat") || body.contains("اتصالات") -> "Etisalat Cash"
                        lowerAddress.contains("we") || body.contains("وي باي") -> "WE Pay"
                        lowerAddress.contains("fawry") || body.contains("فوري") -> "Fawry"
                        lowerAddress.contains("cib") -> "CIB"
                        lowerAddress.contains("nbe") -> "NBE Bank"
                        lowerAddress.contains("misr") -> "Banque Misr"
                        else -> address
                    }

                    list.add(mapOf(
                        "amount" to amount,
                        "currency" to "EGP",
                        "type" to type,
                        "sender" to cleanSender,
                        "description" to "${if (type == "income") "إيداع" else "تحويل"} عبر $cleanSender",
                        "timestamp" to dateLong,
                        "rawMessage" to body
                    ))
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }

        return list
    }

    companion object {
        fun showNativePinnedNotification(context: Context) {
            val channelId = VoiceRecordingService.CHANNEL_ID
            val notificationId = VoiceRecordingService.NOTIFICATION_ID

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val channel = NotificationChannel(
                    channelId,
                    "LifeStyle Quick LockScreen Input",
                    NotificationManager.IMPORTANCE_LOW
                ).apply {
                    description = "Lockscreen quick voice appointment setter"
                    setSound(null, null)
                    enableVibration(false)
                }
                val manager = context.getSystemService(NotificationManager::class.java)
                manager.createNotificationChannel(channel)
            }

            val recordIntent = Intent(context, VoiceActionReceiver::class.java).apply {
                action = "com.example.lifestyle_mobile.RECORD_VOICE"
            }
            val recordPendingIntent = PendingIntent.getBroadcast(
                context,
                101,
                recordIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val openAppIntent = Intent(context, MainActivity::class.java)
            val openAppPendingIntent = PendingIntent.getActivity(
                context,
                102,
                openAppIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val isArabic = Locale.getDefault().language.startsWith("ar")
            val notifTitle = if (isArabic) "لايف ستايل: إضافة موعد سريع" else "LifeStyle: Quick Voice Add"
            val notifText = if (isArabic) "اضغط على الزر وتحدث بصوتك لضبط المنبه فوراً" else "Tap button & speak to set alarm instantly"
            val actionLabel = if (isArabic) "تسجيل صوتي بالمايك" else "Voice Record"

            val notif = NotificationCompat.Builder(context, channelId)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(notifTitle)
                .setContentText(notifText)
                .setContentIntent(openAppPendingIntent)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOngoing(true)
                .setAutoCancel(false)
                .addAction(
                    0,
                    actionLabel,
                    recordPendingIntent
                )
                .build()

            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.notify(notificationId, notif)
        }
    }
}
