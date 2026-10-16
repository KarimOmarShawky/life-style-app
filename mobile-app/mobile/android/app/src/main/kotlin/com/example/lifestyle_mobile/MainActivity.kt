package com.example.lifestyle_mobile

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.speech.RecognizerIntent
import java.util.Locale
import androidx.core.app.NotificationCompat
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private var accountArchiveBridge: AccountArchiveBridge? = null
    private var focusShieldBridge: FocusShieldBridge? = null
    private val CHANNEL = "com.example.lifestyle_mobile/native_voice"
    private val REQUEST_SPEECH = 202
    private val REQUEST_SMS = 303
    private var pendingVoiceResult: MethodChannel.Result? = null
    private var pendingSmsResult: MethodChannel.Result? = null
    private var voiceFallbackTag: String = "en-US"

    /**
     * Resolves the UI language: the language the user picked inside the app
     * (mirrored to SharedPreferences by Flutter) wins, otherwise the device
     * locale is used.
     */
    internal fun resolvedLanguageTag(): String {
        val saved = getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)
            .getString("flutter.app_locale", null)
        if (!saved.isNullOrBlank()) return Locale.forLanguageTag(saved).toLanguageTag()
        return Locale.getDefault().toLanguageTag()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showNativePinnedNotification(this)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        focusShieldBridge = FocusShieldBridge(this, flutterEngine.dartExecutor.binaryMessenger)
        accountArchiveBridge = AccountArchiveBridge(this, flutterEngine.dartExecutor.binaryMessenger)

        // Native Voice Channel
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "hasWalletIngestToken", "storeWalletIngestToken", "clearWalletIngestToken" -> {
                    try {
                        val credentials = WalletCredentialStore(this)
                        when (call.method) {
                            "hasWalletIngestToken" -> result.success(!credentials.read().isNullOrBlank())
                            "storeWalletIngestToken" -> {
                                credentials.write(requireNotNull(call.argument<String>("token")))
                                result.success(null)
                            }
                            else -> { credentials.clear(); result.success(null) }
                        }
                    } catch (_: Exception) {
                        result.error("SECURE_STORAGE_UNAVAILABLE", "Wallet credential storage is unavailable", null)
                    }
                }
                "refreshPinnedNotification" -> {
                    showNativePinnedNotification(this)
                    result.success(true)
                }
                "startVoiceRecognition" -> {
                    if (pendingVoiceResult != null) {
                        result.error("VOICE_BUSY", "Speech input is already active", null)
                    } else {
                        val requestedTag = call.argument<String>("languageTag")
                        voiceFallbackTag = requestedTag?.takeIf { it.isNotBlank() } ?: resolvedLanguageTag()
                        // Existing OS speech UI only. No app-owned recording/cache/upload.
                        // The selected OS recognizer may use its provider's network service.
                        startRecognizerIntent(result)
                    }
                }
                "requestSmsPermission" -> {
                    if (checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED) {
                        result.success(true)
                    } else {
                        pendingSmsResult = result
                        requestPermissions(arrayOf(Manifest.permission.RECEIVE_SMS), REQUEST_SMS)
                    }
                }
                "checkSmsPermission" -> {
                    result.success(
                        checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED
                    )
                }
                else -> result.notImplemented()
            }
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        focusShieldBridge?.onPermissionResult(requestCode)
        if (requestCode == REQUEST_SMS) {
            val granted = grantResults.isNotEmpty() &&
                grantResults[0] == PackageManager.PERMISSION_GRANTED
            pendingSmsResult?.success(granted)
            pendingSmsResult = null
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.data?.scheme == "lifestyle" && intent.data?.host == "focus") {
            FocusShieldEvents.emit(mapOf("type" to "navigateFocus"))
        }
    }

    override fun onDestroy() {
        pendingVoiceResult?.error("VOICE_CANCELLED", "Speech input cancelled on activity disposal", null)
        pendingVoiceResult = null
        accountArchiveBridge?.close()
        accountArchiveBridge = null
        focusShieldBridge?.close()
        focusShieldBridge = null
        super.onDestroy()
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (accountArchiveBridge?.onActivityResult(requestCode, resultCode, data) == true) return
        if (requestCode == REQUEST_SPEECH) {
            val pending = pendingVoiceResult ?: return
            pendingVoiceResult = null
            val text = if (resultCode == Activity.RESULT_OK) {
                data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull() ?: ""
            } else ""
            pending.success(text)
        }
    }

    /**
     * Platform speech recognizer (existing supported path). Listens in the active app
     * language; the BCP-47 tag must be passed as a String or many devices
     * silently fall back to English.
     */
    private fun startRecognizerIntent(result: MethodChannel.Result) {
        val tag = voiceFallbackTag
        try {
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, tag)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, tag)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                putExtra(
                    RecognizerIntent.EXTRA_PROMPT,
                    if (tag.startsWith("ar")) "تحدث بمهمتك الآن..." else "Speak your task now..."
                )
            }
            pendingVoiceResult = result
            startActivityForResult(intent, REQUEST_SPEECH)
        } catch (_: Exception) {
            pendingVoiceResult = null
            result.success("")
        }
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

            val savedLocale = context.getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)
                .getString("flutter.app_locale", null)
            val isArabic = if (!savedLocale.isNullOrBlank()) {
                savedLocale.startsWith("ar")
            } else {
                Locale.getDefault().language.startsWith("ar")
            }
            val notifTitle = if (isArabic) "لايف ستايل: إضافة موعد سريع" else "LifeStyle: Quick Voice Add"
            val notifText = if (isArabic) "افتح التطبيق لإضافة مهمتك؛ لا يتم ضبط منبه تلقائياً" else "Open the app to add a task; no automatic voice alarm"
            val actionLabel = if (isArabic) "فتح التطبيق" else "Open app"

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
