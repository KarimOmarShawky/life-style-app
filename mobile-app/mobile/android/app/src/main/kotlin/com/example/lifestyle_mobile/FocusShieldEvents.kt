package com.example.lifestyle_mobile

import android.os.Handler
import android.os.Looper
import io.flutter.plugin.common.EventChannel

/** Process-only FIFO. No message/sender/action ever enters preferences or logs. */
object FocusShieldEvents {
    private val pending = ArrayDeque<Map<String, Any?>>()
    private var sink: EventChannel.EventSink? = null
    private val main = Handler(Looper.getMainLooper())
    var onSessionEnded: (() -> Unit)? = null

    fun emit(event: Map<String, Any?>) {
        main.post {
            val versioned = event + ("schemaVersion" to 1)
            val target = sink
            if (target == null) {
                if (pending.size >= 100) pending.removeFirst()
                pending.addLast(versioned)
            } else target.success(versioned)
        }
    }
    fun attach(target: EventChannel.EventSink, sessionId: String, active: Boolean) {
        sink = target
        while (pending.isNotEmpty()) {
            val event = pending.removeFirst()
            if (event["type"] == "inbox" && (!active || event["sessionId"] != sessionId)) continue
            target.success(event)
        }
    }
    fun detach() { sink = null }
    fun removeNotification(key: String) {
        main.post { pending.removeAll { it["type"] == "inbox" && it["key"] == key } }
    }
    fun endSession() {
        // Store, services and channel calls all execute on Android's main thread.
        onSessionEnded?.invoke()
        main.post { pending.removeAll { it["type"] == "inbox" || it["type"] == "removed" } }
    }
}
