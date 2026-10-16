package com.example.lifestyle_mobile

import android.app.Service
import android.content.Intent
import android.os.IBinder

/**
 * Compatibility entry for an old private service component. Its Gemini key reader
 * always returned empty, so cloud transcription/alarm scheduling could never run.
 * Do not capture/store voice or claim an alarm was created. New notification actions
 * open the app through VoiceActionReceiver; in-app speech uses the existing OS UI.
 * Keep identifiers stable for existing notifications, without touching saved alarms.
 * Android lifecycle/notification behavior still requires a real build/device check.
 */
class VoiceRecordingService : Service() {
    companion object {
        const val CHANNEL_ID = "lifestyle_quick_input_channel"
        const val NOTIFICATION_ID = 777
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        MainActivity.showNativePinnedNotification(this)
        stopSelf()
        return START_NOT_STICKY
    }
}
