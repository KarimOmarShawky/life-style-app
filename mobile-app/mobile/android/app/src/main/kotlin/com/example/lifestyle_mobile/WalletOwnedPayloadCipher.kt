package com.example.lifestyle_mobile

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.Locale
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Cryptographic building block for future owner-bound wallet queue entries.
 * The owner and content are encrypted and authenticated together, and the
 * queue key is authenticated as associated data. A ciphertext therefore
 * cannot be moved to another queue key or another item. This class does not
 * establish the current account or choose the owner; capture must supply an
 * independently authenticated session snapshot at the correct boundary.
 *
 * Do not use the legacy wallet queue encryption key with this format: the
 * legacy method channel can encrypt arbitrary plaintext. A distinct key and
 * a restricted writer are required before this can establish provenance.
 */
internal class WalletOwnedPayloadCipher(private val key: SecretKey) {
    internal class Sealed(val iv: ByteArray, val ciphertext: ByteArray)
    internal class Record(val ownerId: String, val payload: String) {
        override fun toString(): String = "WalletOwnedRecord([redacted])"
    }

    fun seal(recordKey: String, ownerId: String, payload: String): Sealed {
        require(validKey(recordKey))
        require(UUID.matches(ownerId))
        val body = payload.toByteArray(Charsets.UTF_8)
        require(body.isNotEmpty() && body.size <= MAX_PAYLOAD_BYTES)
        val owner = ownerId.lowercase(Locale.ROOT).toByteArray(Charsets.US_ASCII)
        val plaintext = owner + byteArrayOf(0) + body
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key)
        cipher.updateAAD(aad(recordKey))
        val encrypted = cipher.doFinal(plaintext)
        check(cipher.iv.size == IV_BYTES)
        return Sealed(cipher.iv, encrypted)
    }

    /** Returns null for anything unauthenticated, malformed, misplaced or unreadable. */
    fun open(recordKey: String, iv: ByteArray, ciphertext: ByteArray): Record? {
        if (!validKey(recordKey) || iv.size != IV_BYTES || ciphertext.size < MIN_CIPHERTEXT_BYTES ||
            ciphertext.size > MAX_CIPHERTEXT_BYTES) return null
        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
            cipher.updateAAD(aad(recordKey))
            val plaintext = cipher.doFinal(ciphertext)
            if (plaintext.size <= OWNER_BYTES + 1 || plaintext[OWNER_BYTES] != 0.toByte()) return null
            val ownerId = String(plaintext, 0, OWNER_BYTES, Charsets.US_ASCII)
            if (!UUID.matches(ownerId) || ownerId != ownerId.lowercase(Locale.ROOT)) return null
            val payload = Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(plaintext, OWNER_BYTES + 1, plaintext.size - OWNER_BYTES - 1))
                .toString()
            Record(ownerId, payload)
        } catch (_: Exception) {
            null
        }
    }

    companion object {
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val TAG_BITS = 128
        private const val IV_BYTES = 12
        private const val OWNER_BYTES = 36
        private const val MAX_PAYLOAD_BYTES = 65536
        private const val MIN_CIPHERTEXT_BYTES = OWNER_BYTES + 1 + 1 + TAG_BITS / 8
        private const val MAX_CIPHERTEXT_BYTES = OWNER_BYTES + 1 + MAX_PAYLOAD_BYTES + TAG_BITS / 8
        private val UUID = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
        private val KEY = Regex("^pending_wallet_(?:candidate|review|tx)\\.[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
        private fun validKey(value: String): Boolean = KEY.matches(value)
        private fun aad(recordKey: String): ByteArray =
            ("lifestyle.wallet.owned.v1\u0000" + recordKey).toByteArray(Charsets.UTF_8)
    }
}
