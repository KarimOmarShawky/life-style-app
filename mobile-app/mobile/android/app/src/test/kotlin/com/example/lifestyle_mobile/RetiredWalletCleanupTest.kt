package com.example.lifestyle_mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RetiredWalletCleanupTest {
    @Test
    fun `matches only retired wallet data and leaves unrelated preferences alone`() {
        listOf(
            "flutter.pending_wallet_tx.item",
            "flutter.pending_wallet_candidate.item",
            "flutter.pending_wallet_review.item",
            "flutter.pending_wallet_quarantine.item",
            "flutter.wallet_legacy_hold.item",
            "flutter.wallet_tx_rejected.item",
            "flutter.lifestyle.wallet_ingest_token.v1",
            "flutter.wallet_trusted_senders",
            "flutter.sms_sync_enabled"
        ).forEach { assertTrue(it, RetiredWalletCleanup.isRetiredKey(it)) }
        listOf(
            "flutter.app_locale",
            "flutter.lifestyle.api_base_url",
            "flutter.subscription_reminders",
            "flutter.auth_token",
            "flutter.pending_wallet_tx_extra",
            "pending_wallet_tx.item"
        ).forEach { assertFalse(it, RetiredWalletCleanup.isRetiredKey(it)) }
    }
    @Test
    fun `continues after individual failures and retries all steps`() {
        val calls = mutableListOf<String>()
        var fail = true
        val steps = listOf<() -> Unit>(
            { calls.add("preferences"); if (fail) error("synthetic failure") },
            { calls.add("credentials") },
            { calls.add("key-a"); if (fail) error("synthetic failure") },
            { calls.add("key-b") },
            { calls.add("notification") }
        )
        assertFalse(RetiredWalletCleanup.runSteps(steps))
        assertEquals(listOf("preferences", "credentials", "key-a", "key-b", "notification"), calls)
        calls.clear(); fail = false
        assertTrue(RetiredWalletCleanup.runSteps(steps))
        assertEquals(listOf("preferences", "credentials", "key-a", "key-b", "notification"), calls)
    }
}
