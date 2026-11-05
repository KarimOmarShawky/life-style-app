package com.example.lifestyle_mobile

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WalletBoundCredentialTest {
    private val token = "lsi_" + "A".repeat(43)
    private val owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

    @Test fun roundTripsTokenAndOwnerAsOneValue() {
        val saved = WalletBoundCredential.encode(token, owner.uppercase())
        val bound = WalletBoundCredential.decode(saved)!!
        assertTrue(bound.token == token)
        assertTrue(bound.ownerId == owner)
        assertFalse(bound.toString().contains(token))
    }

    @Test fun legacyTokenHasNoImpliedOwner() {
        assertTrue(WalletBoundCredential.decode(token) == null)
    }

    @Test fun malformedBoundValuesCannotBecomeLegacyTokens() {
        val values = listOf(
            "wallet-bound-v1:$owner:lsi_bad",
            "wallet-bound-v1:not-uuid:$token",
            "wallet-bound-v1:$owner:$token:extra",
            "wallet-bound-v1:",
            "wallet-bound-v2:$owner:$token"
        )
        for (value in values) {
            var rejected = false
            try {
                WalletBoundCredential.decode(value)
            } catch (_: IllegalArgumentException) {
                rejected = true
            }
            assertTrue(rejected)
        }
    }

    @Test fun writeRejectsInvalidOwnerAndToken() {
        for ((badToken, badOwner) in listOf(token to "", "bad" to owner, token to "not-uuid")) {
            var rejected = false
            try {
                WalletBoundCredential.encode(badToken, badOwner)
            } catch (_: IllegalArgumentException) {
                rejected = true
            }
            assertTrue(rejected)
        }
    }
}
