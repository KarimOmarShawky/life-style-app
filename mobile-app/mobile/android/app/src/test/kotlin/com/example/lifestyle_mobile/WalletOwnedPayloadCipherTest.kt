package com.example.lifestyle_mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import javax.crypto.Cipher
import javax.crypto.KeyGenerator

class WalletOwnedPayloadCipherTest {
    private val ownerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    private val ownerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    private val idA = "11111111-1111-4111-8111-111111111111"
    private val idB = "22222222-2222-4222-8222-222222222222"
    private val keyA = "pending_wallet_candidate.$idA"
    private val secret = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    private val cipher = WalletOwnedPayloadCipher(secret)

    @Test fun ownerAndPayloadAreAuthenticatedTogether() {
        val payload = "{\"message\":\"Paid 50 EGP: مرحبا\"}"
        val sealed = cipher.seal(keyA, ownerA.uppercase(), payload)
        val record = cipher.open(keyA, sealed.iv, sealed.ciphertext)!!
        assertEquals(ownerA, record.ownerId)
        assertEquals(payload, record.payload)
        assertFalse(record.toString().contains(payload))
        assertFalse(record.toString().contains(ownerA))
        assertFalse(String(sealed.ciphertext, Charsets.ISO_8859_1).contains(payload))
    }

    @Test fun cannotMoveCiphertextToAnotherIdOrQueue() {
        val sealed = cipher.seal(keyA, ownerA, "private data")
        assertNull(cipher.open("pending_wallet_candidate.$idB", sealed.iv, sealed.ciphertext))
        assertNull(cipher.open("pending_wallet_review.$idA", sealed.iv, sealed.ciphertext))
        assertNull(cipher.open("pending_wallet_tx.$idA", sealed.iv, sealed.ciphertext))
    }

    @Test fun tamperingWrongKeyAndMalformedValuesFailClosed() {
        val sealed = cipher.seal(keyA, ownerA, "private data")
        val tampered = sealed.ciphertext.clone().apply { this[0] = (this[0].toInt() xor 1).toByte() }
        assertNull(cipher.open(keyA, sealed.iv, tampered))
        val wrongIv = sealed.iv.clone().apply { this[0] = (this[0].toInt() xor 1).toByte() }
        assertNull(cipher.open(keyA, wrongIv, sealed.ciphertext))
        val otherKey = WalletOwnedPayloadCipher(KeyGenerator.getInstance("AES").apply { init(256) }.generateKey())
        assertNull(otherKey.open(keyA, sealed.iv, sealed.ciphertext))
        assertNull(cipher.open(keyA, byteArrayOf(), sealed.ciphertext))
        assertNull(cipher.open(keyA, sealed.iv, byteArrayOf()))
        assertNull(cipher.open("pending_wallet_candidate.not-a-uuid", sealed.iv, sealed.ciphertext))
    }

    @Test fun authenticatedButMalformedPlaintextIsStillRejected() {
        fun rawSeal(plain: ByteArray): Pair<ByteArray, ByteArray> {
            val raw = Cipher.getInstance("AES/GCM/NoPadding")
            raw.init(Cipher.ENCRYPT_MODE, secret)
            raw.updateAAD(("lifestyle.wallet.owned.v1\u0000" + keyA).toByteArray(Charsets.UTF_8))
            val encrypted = raw.doFinal(plain)
            return raw.iv to encrypted
        }
        val cases = listOf(
            ("z".repeat(36) + "\u0000data").toByteArray(),
            (ownerA + "Xdata").toByteArray(),
            (ownerA + "\u0000").toByteArray(),
            (ownerA + "\u0000").toByteArray() + byteArrayOf(0xc3.toByte(), 0x28),
            (ownerA.uppercase() + "\u0000data").toByteArray()
        )
        for (plain in cases) {
            val (iv, encrypted) = rawSeal(plain)
            assertNull(cipher.open(keyA, iv, encrypted))
        }
    }

    @Test fun separateAccountsDoNotShareAnOwnerAndNoncesAreFresh() {
        val a = cipher.seal(keyA, ownerA, "same")
        val anotherA = cipher.seal(keyA, ownerA, "same")
        val b = cipher.seal(keyA, ownerB, "same")
        assertEquals(ownerA, cipher.open(keyA, a.iv, a.ciphertext)!!.ownerId)
        assertEquals(ownerB, cipher.open(keyA, b.iv, b.ciphertext)!!.ownerId)
        assertFalse(a.iv.contentEquals(anotherA.iv))
        assertFalse(a.ciphertext.contentEquals(anotherA.ciphertext))
    }

    @Test fun sealRejectsInvalidOwnersKeysAndPayloads() {
        for ((key, owner, payload) in listOf(
            Triple(keyA, "", "data"),
            Triple(keyA, "not-uuid", "data"),
            Triple("pending_wallet_candidate.not-uuid", ownerA, "data"),
            Triple("other.$idA", ownerA, "data"),
            Triple(keyA, ownerA, ""),
            Triple(keyA, ownerA, "x".repeat(65537))
        )) {
            var failed = false
            try { cipher.seal(key, owner, payload) } catch (_: IllegalArgumentException) { failed = true }
            assertTrue(failed)
        }
    }
}
