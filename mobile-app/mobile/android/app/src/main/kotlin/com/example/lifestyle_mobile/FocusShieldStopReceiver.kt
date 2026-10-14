package com.example.lifestyle_mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class FocusShieldStopReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val store = FocusShieldSessionStore(context)
        when (intent.action) {
            FocusShieldSessionStore.ACTION_EXPIRE -> store.current()
            FocusShieldSessionStore.ACTION_STOP -> store.stop("manual")
            Intent.ACTION_BOOT_COMPLETED -> store.stop("reboot")
        }
    }
}
