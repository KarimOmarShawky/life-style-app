package com.example.lifestyle_mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

class VoiceActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val serviceIntent = Intent(context, VoiceRecordingService::class.java).apply {
            action = intent.action
        }
        ContextCompat.startForegroundService(context, serviceIntent)
    }
}
