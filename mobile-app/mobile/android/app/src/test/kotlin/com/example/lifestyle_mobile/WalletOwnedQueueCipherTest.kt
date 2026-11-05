package com.example.lifestyle_mobile

import org.junit.Assert.assertNull
import org.junit.Test

class WalletOwnedQueueCipherTest {
    @Test fun legacyAndInvalidEnvelopesNeverGetAnInferredOwner() {
        val queue = WalletOwnedQueueCipher()
        val key = "pending_wallet_candidate.11111111-1111-4111-8111-111111111111"
        for (stored in listOf(
            "",
            "{\"ownerId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"text\":\"legacy\"}",
            "{\"v\":2,\"iv\":\"old\",\"ct\":\"old\"}",
            "wallet-owned-v2:iv:ct",
            "wallet-owned-v1:",
            "wallet-owned-v1:iv:ct:extra",
            "wallet-owned-v1:" + "x".repeat(90001)
        )) assertNull(queue.open(key, stored))
    }
}
