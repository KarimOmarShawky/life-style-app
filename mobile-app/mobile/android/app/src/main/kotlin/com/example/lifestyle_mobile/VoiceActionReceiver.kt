package com.example.lifestyle_mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class VoiceActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        // Preserve old notification PendingIntents without starting a dead
        // microphone/cloud-transcription service. Speech input stays in the app.
        context.startActivity(Intent(context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        })
    }
}
