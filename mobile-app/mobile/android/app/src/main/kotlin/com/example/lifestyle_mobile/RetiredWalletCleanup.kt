package com.example.lifestyle_mobile

import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.util.Log
import java.security.KeyStore

/** Remove only the canceled wallet's local data. Never touches SMS or subscriptions. */
internal object RetiredWalletCleanup {
    private val prefixes = listOf(
        "flutter.pending_wallet_tx.",
        "flutter.pending_wallet_candidate.",
        "flutter.pending_wallet_review.",
        "flutter.pending_wallet_quarantine.",
        "flutter.wallet_legacy_hold.",
        "flutter.wallet_tx_rejected."
    )
    private val keys = setOf(
        "flutter.sms_sync_enabled",
        "flutter.wallet_notification_details",
        "flutter.wallet_trusted_senders",
        "flutter.wallet_sms_fallback_unavailable",
        "flutter.wallet_sms_quarantined",
        "flutter.wallet_storage_fault",
        "flutter.lifestyle.wallet_ingest_token.v1"
    )
    private val aliases = listOf(
        "lifestyle.wallet.ingest.v1",
        "lifestyle.wallet.queue.v1",
        "lifestyle.wallet.queue.owned.v1"
    )

    internal fun isRetiredKey(key: String): Boolean =
        key in keys || prefixes.any { key.startsWith(it) }

    /** Attempt every independent store, even if a previous operation failed. */
    internal fun runSteps(steps: List<() -> Unit>): Boolean {
        var complete = true
        steps.forEach { step ->
            try { step() } catch (_: Exception) { complete = false }
        }
        return complete
    }

    /** Called on every launch; failed/partial work is retried on the next launch. */
    fun run(context: Context): Boolean {
        val retiredChannel = "lifestyle_sms_transactions_channel"
        val steps = mutableListOf<() -> Unit>(
            {
                val prefs = context.getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)
                val editor = prefs.edit()
                prefs.all.keys.filter(::isRetiredKey).forEach { editor.remove(it) }
                check(editor.commit())
            },
            {
                check(context.getSharedPreferences("wallet_credentials", Context.MODE_PRIVATE).edit().clear().commit())
            }
        )
        // A failure for one Keystore alias must not prevent deleting the others.
        aliases.forEach { alias ->
            steps.add {
                val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
                if (store.containsAlias(alias)) store.deleteEntry(alias)
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            steps.add {
                val notifications = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                // IDs are shared with unrelated features (focus timer uses 999).
                notifications.activeNotifications
                    .filter { it.notification.channelId == retiredChannel }
                    .forEach { notifications.cancel(it.tag, it.id) }
            }
            steps.add {
                val notifications = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                notifications.deleteNotificationChannel(retiredChannel)
            }
        }
        // Before O there is no reliable channel discriminator: do not cancel by
        // shared ID and risk removing an unrelated focus notification.
        val complete = runSteps(steps)
        if (!complete) Log.w("RetiredWalletCleanup", "Retired local data cleanup incomplete; will retry")
        return complete
    }
}
