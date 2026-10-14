package com.example.lifestyle_mobile

import android.app.Notification
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Telephony
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat

class FocusNotificationListenerService : NotificationListenerService() {
    override fun onCreate() {
        super.onCreate()
        FocusShieldEvents.onSessionEnded = { replies.clear() }
        FocusShieldSessionStore(this).current()
    }
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        try { capture(sbn) } catch (_: RuntimeException) {
            replies.remove(sbn.key)
            FocusShieldEvents.removeNotification(sbn.key)
        }
    }
    private fun capture(sbn: StatusBarNotification) {
        FocusShieldSessionStore(this).withActiveSession { sessionId -> captureActive(sbn, sessionId) }
    }
    private fun captureActive(sbn: StatusBarNotification, sessionId: String) {
        val notification = sbn.notification
        if (sbn.packageName == packageName ||
            (sbn.packageName !in MESSAGING_PACKAGES && sbn.packageName != Telephony.Sms.getDefaultSmsPackage(this)) ||
            (notification.flags and (Notification.FLAG_GROUP_SUMMARY or Notification.FLAG_ONGOING_EVENT)) != 0) return
        val messaging = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(notification)
        if (notification.category != Notification.CATEGORY_MESSAGE && messaging == null) return
        val action = notification.actions?.firstOrNull { candidate -> candidate.remoteInputs?.any { it.allowFreeFormInput } == true }
        val evicted = replies.put(sbn.key, CachedReply(sessionId, action, System.currentTimeMillis()))
        if (evicted != null) {
            FocusShieldEvents.removeNotification(evicted)
            FocusShieldEvents.emit(mapOf("type" to "removed", "key" to evicted, "sessionId" to sessionId))
        }
        val last = messaging?.messages?.lastOrNull()
        val sender = last?.person?.name?.toString() ?: notification.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
        val text = last?.text?.toString() ?: notification.extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
        FocusShieldEvents.emit(mapOf("type" to "inbox", "sessionId" to sessionId,
            "key" to sbn.key, "packageName" to sbn.packageName, "sender" to sender.take(500), "text" to text.take(10000)))
    }
    override fun onNotificationRemoved(sbn: StatusBarNotification) {
        // Even removals are session/expiry guarded. Clear queued content as well.
        val store = FocusShieldSessionStore(this)
        val active = store.current().active
        val cached = replies.remove(sbn.key)
        FocusShieldEvents.removeNotification(sbn.key)
        if (!active) { replies.clear(); return }
        if (cached != null) FocusShieldEvents.emit(mapOf("type" to "removed", "key" to sbn.key, "sessionId" to cached.sessionId))
    }
    override fun onListenerDisconnected() { replies.clear(); super.onListenerDisconnected() }
    override fun onDestroy() { replies.clear(); super.onDestroy() }

    companion object {
        private data class CachedReply(val sessionId: String, val action: Notification.Action?, val capturedAt: Long)
        private val replies = BoundedMemoryCache<String, CachedReply>(100)
        private const val MAX_REPLY_AGE_MS = 5 * 60 * 1000L
        private val MESSAGING_PACKAGES = setOf("com.whatsapp", "com.whatsapp.w4b", "com.instagram.android",
            "com.instagram.lite", "com.facebook.orca", "com.facebook.mlite", "org.telegram.messenger",
            "org.telegram.messenger.web", "com.google.android.apps.messaging", "com.android.mms", "com.samsung.android.messaging")
        enum class ReplyResult { sent, stale, noReplyAction, failed }

        fun sendInlineReply(context: Context, key: String, text: String): ReplyResult {
            val store = FocusShieldSessionStore(context)
            if (!store.current().active) { replies.clear(); return ReplyResult.stale }
            val cached = replies.get(key) ?: return ReplyResult.stale
            if (cached.sessionId != store.snapshot()["sessionId"] || System.currentTimeMillis() - cached.capturedAt >= MAX_REPLY_AGE_MS) {
                replies.remove(key)
                FocusShieldEvents.removeNotification(key)
                return ReplyResult.stale
            }
            if (text.isBlank() || text.length > 10000) return ReplyResult.failed
            val action = cached.action ?: return ReplyResult.noReplyAction
            val pendingIntent = action.actionIntent ?: return ReplyResult.noReplyAction
            // Immutable actions discard fill-in reply data; activity actions can
            // open the distracting app. Neither is a supported inline reply.
            if (Build.VERSION.SDK_INT >= 31 && (pendingIntent.isImmutable || pendingIntent.isActivity)) return ReplyResult.noReplyAction
            val input = action.remoteInputs?.firstOrNull { it.allowFreeFormInput } ?: return ReplyResult.noReplyAction
            return try {
                val results = Bundle().apply { putCharSequence(input.resultKey, text) }
                val fillIn = Intent()
                RemoteInput.addResultsToIntent(arrayOf(input), fillIn, results)
                if (Build.VERSION.SDK_INT >= 28) RemoteInput.setResultsSource(fillIn, RemoteInput.SOURCE_FREE_FORM_INPUT)
                pendingIntent.send(context, 0, fillIn)
                ReplyResult.sent
            } catch (_: PendingIntent.CanceledException) {
                replies.remove(key)
                ReplyResult.stale
            } catch (_: Exception) { ReplyResult.failed }
        }
    }
}
