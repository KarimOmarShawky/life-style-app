package com.example.lifestyle_mobile

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WalletLegacyRetentionTest {
    private val now = 1_800_000_000_000L

    @Test fun oldOrUndatedEntriesAreHeldNotExpired() {
        val window = WalletLegacyRetention.WINDOW_MS
        assertTrue(WalletLegacyRetention.hold(0L, now))
        assertTrue(WalletLegacyRetention.hold(-1L, now))
        assertTrue(WalletLegacyRetention.hold(now - window - 1, now))
        assertFalse(WalletLegacyRetention.hold(now - window, now))
        assertFalse(WalletLegacyRetention.hold(now - 1, now))
        assertFalse(WalletLegacyRetention.hold(now + 1, now))
    }
}
