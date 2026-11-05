package com.example.lifestyle_mobile

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/**
 * Separate Keystore key for future owner-bound queue entries. Not exposed over
 * the legacy arbitrary-plaintext encryption method channel. A caller must
 * validate that [WalletBoundCredential] represents the live capture session;
 * possession of a bound credential alone does not establish that boundary.
 *
 * This is not wired into capture or processing yet. In particular, it does not
 * make ownerless historical entries safe to display, send or delete.
 */
internal class WalletOwnedQueueCipher {
    fun seal(recordKey: String, credential: WalletBoundCredential, payload: String): String {
        val secret = requireNotNull(key(create = true))
        val sealed = WalletOwnedPayloadCipher(secret).seal(recordKey, credential.ownerId, payload)
        return PREFIX + Base64.encodeToString(sealed.iv, Base64.NO_WRAP) + ":" +
            Base64.encodeToString(sealed.ciphertext, Base64.NO_WRAP)
    }

    /** Legacy/plaintext/unknown versions are not decoded and never gain an owner. */
    fun open(recordKey: String, stored: String): WalletOwnedPayloadCipher.Record? {
        if (!stored.startsWith(PREFIX) || stored.length > MAX_ENVELOPE_CHARS) return null
        return try {
            val parts = stored.removePrefix(PREFIX).split(':')
            if (parts.size != 2) return null
            val secret = key(create = false) ?: return null
            WalletOwnedPayloadCipher(secret).open(
                recordKey,
                Base64.decode(parts[0], Base64.NO_WRAP),
                Base64.decode(parts[1], Base64.NO_WRAP)
            )
        } catch (_: Exception) {
            null
        }
    }

    private fun key(create: Boolean): SecretKey? = synchronized(lock) {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return@synchronized it }
        if (!create) return@synchronized null
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        generator.generateKey()
    }

    companion object {
        private const val ALIAS = "lifestyle.wallet.queue.owned.v1"
        private const val PREFIX = "wallet-owned-v1:"
        private const val MAX_ENVELOPE_CHARS = 90000
        private val lock = Any()
    }
}
