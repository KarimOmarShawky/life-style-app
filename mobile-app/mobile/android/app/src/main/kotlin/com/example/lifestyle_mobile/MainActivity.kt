package com.example.lifestyle_mobile

import android.app.NotificationManager
import android.content.Intent
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private var accountArchiveBridge: AccountArchiveBridge? = null
    private var focusShieldBridge: FocusShieldBridge? = null
    private val CHANNEL = "com.example.lifestyle_mobile/native_voice"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        RetiredWalletCleanup.run(this)
        clearLegacyQuickVoiceNotification()
    }

    /**
     * The pinned quick-voice notification shipped with the removed voice
     * feature. Clear the stale ongoing notification and its channel once so
     * upgraders are not left with a dead lockscreen entry.
     */
    private fun clearLegacyQuickVoiceNotification() {
        try {
            val manager = getSystemService(NotificationManager::class.java)
            manager.cancel(LEGACY_QUICK_VOICE_NOTIFICATION_ID)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                manager.deleteNotificationChannel(LEGACY_QUICK_VOICE_CHANNEL_ID)
            }
        } catch (_: Exception) {
        }
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        focusShieldBridge = FocusShieldBridge(this, flutterEngine.dartExecutor.binaryMessenger)
        accountArchiveBridge = AccountArchiveBridge(this, flutterEngine.dartExecutor.binaryMessenger)

        // Shared native bridge: retired-wallet cleanup and subscription
        // reminders. The channel keeps its legacy name (pinned by the
        // reminder/wallet contract tests); the voice feature that lent it
        // the name was removed — nothing here records or transcribes audio.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    // This method only erases old data; it cannot read or recreate it.
                    "cleanupRetiredWallet" -> {
                        if (RetiredWalletCleanup.run(this)) result.success(null)
                        else result.error("RETIRED_CLEANUP_INCOMPLETE", "Retired data cleanup incomplete", null)
                    }
                    "replaceSubscriptionReminders" -> {
                        try {
                            SubscriptionReminderScheduler.replace(
                                this,
                                requireNotNull(call.argument<String>("account")),
                                requireNotNull(call.argument<List<Any>>("schedules"))
                            )
                            result.success(null)
                        } catch (_: Exception) {
                            result.error("REMINDER_UNAVAILABLE", "Subscription reminders are unavailable", null)
                        }
                    }
                    "removeSubscriptionReminder" -> {
                        try {
                            SubscriptionReminderScheduler.remove(
                                this,
                                requireNotNull(call.argument<String>("account")),
                                requireNotNull(call.argument<String>("id"))
                            )
                            result.success(null)
                        } catch (_: Exception) {
                            result.error("REMINDER_UNAVAILABLE", "Subscription reminders are unavailable", null)
                        }
                    }
                    "clearSubscriptionReminders" -> {
                        try {
                            SubscriptionReminderScheduler.clear(this)
                            result.success(null)
                        } catch (_: Exception) {
                            result.error("REMINDER_UNAVAILABLE", "Subscription reminders are unavailable", null)
                        }
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
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.data?.scheme == "lifestyle" && intent.data?.host == "focus") {
            FocusShieldEvents.emit(mapOf("type" to "navigateFocus"))
        }
    }

    override fun onDestroy() {
        accountArchiveBridge?.close()
        accountArchiveBridge = null
        focusShieldBridge?.close()
        focusShieldBridge = null
        super.onDestroy()
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (accountArchiveBridge?.onActivityResult(requestCode, resultCode, data) == true) return
    }

    private companion object {
        const val LEGACY_QUICK_VOICE_NOTIFICATION_ID = 777
        const val LEGACY_QUICK_VOICE_CHANNEL_ID = "lifestyle_quick_input_channel"
    }
}
