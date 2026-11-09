package com.example.lifestyle_mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class VoiceActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        // Preserve old notification PendingIntents without starting a dead
        // microphone/cloud-transcription service. Speech input stays in the
        // app: the extra only asks MainActivity to open the in-app voice
        // quick-add once Flutter is ready. Nothing is recorded in background.
        context.startActivity(Intent(context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            putExtra(MainActivity.EXTRA_QUICK_VOICE, true)
        })
    }
}
