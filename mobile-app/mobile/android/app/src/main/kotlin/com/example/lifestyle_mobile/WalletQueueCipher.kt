package com.example.lifestyle_mobile

/**
 * Device-bound AES-GCM envelope for the local wallet queues (F-05).
 *
 * Candidates, review items and pending transactions contain sanitized SMS text,
 * senders and financial amounts. They used to sit in plaintext inside
 * FlutterSharedPreferences: `android:allowBackup=false` keeps them out of
 * ordinary backups but does nothing for a rooted or compromised device.
 *
 * This cipher stores them as an AES-256-GCM envelope whose key never leaves
 * the Android Keystore, exactly like the ingest credential. There is no
 * plaintext fallback: if the key cannot be created, the entry is not written.
 *
 * Envelope format (JSON, so Dart can detect it without a native call):
 *   {"v":2,"iv":"<base64>","ct":"<base64>"}
 *
 * Version 1 was the raw JSON object. v1 values are still readable so devices
 * upgrade without losing queued data; anything written after this change is v2.
 */

import android.util.Base64
import android.util.Log
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class WalletQueueCipher {
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
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
        return generator.generateKey()
    }

    /** Encrypts [plain] into a v2 envelope. Throws when the Keystore is unusable. */
    fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val envelope = JSONObject()
            .put("v", VERSION)
            .put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .put("ct", Base64.encodeToString(cipher.doFinal(plain.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP))
        return envelope.toString()
    }

    /**
     * Returns the stored payload as plaintext. v1 (unencrypted JSON) values are
     * returned unchanged so already-queued entries migrate instead of vanishing.
     * Returns null when a v2 envelope cannot be authenticated.
     */
    fun decrypt(stored: String): String? {
        if (!isEnvelope(stored)) return stored
        return try {
            val envelope = JSONObject(stored)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(
                Cipher.DECRYPT_MODE,
                key(),
                GCMParameterSpec(TAG_BITS, Base64.decode(envelope.getString("iv"), Base64.NO_WRAP))
            )
            String(
                cipher.doFinal(Base64.decode(envelope.getString("ct"), Base64.NO_WRAP)),
                Charsets.UTF_8
            )
        } catch (e: Exception) {
            Log.e(TAG, "Wallet queue entry could not be decrypted", e)
            null
        }
    }

    companion object {
        const val TAG = "WalletQueueCipher"
        const val VERSION = 2
        private const val ALIAS = "lifestyle.wallet.queue.v1"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val TAG_BITS = 128

        /** True when [stored] is a v2 ciphertext envelope rather than v1 JSON. */
        fun isEnvelope(stored: String): Boolean {
            if (!stored.startsWith("{\"v\":")) return false
            return try {
                JSONObject(stored).optInt("v", 0) >= VERSION
            } catch (e: Exception) {
                false
            }
        }
    }
}
