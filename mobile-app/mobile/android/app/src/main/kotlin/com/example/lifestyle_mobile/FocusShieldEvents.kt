package com.example.lifestyle_mobile

import android.os.Handler
import android.os.Looper
import io.flutter.plugin.common.EventChannel

/** Process-only FIFO. No message/sender/action ever enters preferences or logs. */
object FocusShieldEvents {
    private val lock = Any()
    private val pending = ArrayDeque<Map<String, Any?>>()
    private var sink: EventChannel.EventSink? = null
    private var drainPosted = false
    private val main = Handler(Looper.getMainLooper())
    @Volatile var onSessionEnded: (() -> Unit)? = null

    fun emit(event: Map<String, Any?>) = synchronized(lock) {
        if (pending.size >= 100) pending.removeFirst()
        pending.addLast(event + ("schemaVersion" to 1))
        scheduleDrain()
    }
    // One data-free Runnable, not one Runnable retaining each incoming message.
    // Even callbacks on pre-N binder threads cannot create an unbounded queue.
    private fun scheduleDrain() {
        if (sink == null || drainPosted) return
        drainPosted = true
        main.post {
            synchronized(lock) {
                drainPosted = false
                val target = sink ?: return@synchronized
                while (pending.isNotEmpty()) {
                    try { target.success(pending.removeFirst()) } catch (_: RuntimeException) {
                        sink = null // Detached engine; retain only the bounded remainder.
                        break
                    }
                }
            }
        }
    }
    fun attach(target: EventChannel.EventSink, sessionId: String, active: Boolean) = synchronized(lock) {
        sink = target
        pending.removeAll { it["type"] == "inbox" && (!active || it["sessionId"] != sessionId) }
        scheduleDrain()
    }
    fun detach() = synchronized(lock) { sink = null }
    fun removeNotification(key: String) = synchronized(lock) {
        pending.removeAll { it["type"] == "inbox" && it["key"] == key }
    }
    fun endSession() {
        synchronized(lock) { pending.removeAll { it["type"] == "inbox" || it["type"] == "removed" } }
        onSessionEnded?.invoke()
    }
}
