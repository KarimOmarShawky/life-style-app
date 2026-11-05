package com.example.lifestyle_mobile

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Device-bound AES-GCM. No plaintext fallback; keys never leave Android Keystore. */
class WalletCredentialStore(context: Context) {
    private val prefs = context.getSharedPreferences("wallet_credentials", Context.MODE_PRIVATE)
    private val legacy = context.getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true).build())
        return generator.generateKey()
    }
    /** The old token API remains compatible but never infers an owner. */
    fun read(): String? = synchronized(lock) {
        val raw = readPlain() ?: return@synchronized null
        WalletBoundCredential.decode(raw)?.token ?: raw
    }

    /** Returns null for a legacy token without an owner; no migration guesses. */
    internal fun readBound(): WalletBoundCredential? = synchronized(lock) {
        readPlain()?.let(WalletBoundCredential::decode)
    }

    private fun readPlain(): String? {
        val saved = prefs.getString("token", null)
        if (saved == null) {
            val old = legacy.getString(LEGACY, null) ?: return null
            write(old) // Delete legacy only after durable encryption succeeds.
            return old
        }
        val parts = saved.split(':')
        require(parts.size == 2)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)))
        return String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), Charsets.UTF_8)
    }

    fun write(token: String) = synchronized(lock) {
        require(token.isNotBlank())
        // This legacy API stores no owner. Do not silently attach the current account.
        writePlain(token)
    }

    /** One encrypted preference commit stores both fields as an indivisible value. */
    internal fun writeBound(token: String, ownerId: String) = synchronized(lock) {
        writePlain(WalletBoundCredential.encode(token, ownerId))
    }

    private fun writePlain(value: String) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val encrypted = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" +
            Base64.encodeToString(cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
        check(prefs.edit().putString("token", encrypted).commit())
        check(legacy.edit().remove(LEGACY).commit())
    }
    fun clear(expected: String? = null) = synchronized(lock) {
        if (expected != null && read() != expected) return@synchronized
        check(prefs.edit().remove("token").commit())
        check(legacy.edit().remove(LEGACY).commit())
    }
    companion object {
        private const val ALIAS = "lifestyle.wallet.ingest.v1"
        private const val LEGACY = "flutter.lifestyle.wallet_ingest_token.v1"
        private val lock = Any()
    }
}
