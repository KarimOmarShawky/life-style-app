package com.example.lifestyle_mobile

import java.util.Locale

/**
 * Serialized inside the existing AES-GCM protected credential, never separately
 * in preferences. This binds a token to the owner returned alongside it by the
 * server; it does not bind or infer the owner of any queued message.
 */
internal class WalletBoundCredential private constructor(
    val token: String,
    val ownerId: String
) {
    override fun toString(): String = "WalletBoundCredential([redacted])"

    companion object {
        private const val PREFIX = "wallet-bound-v1:"
        private val uuid = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
        private val ingestToken = Regex("^lsi_[A-Za-z0-9_-]{43}$")

        fun encode(token: String, ownerId: String): String {
            require(uuid.matches(ownerId) && ingestToken.matches(token))
            return PREFIX + ownerId.lowercase(Locale.ROOT) + ":" + token
        }

        /** Null only for legacy unbound tokens; a malformed bound value fails closed. */
        fun decode(value: String): WalletBoundCredential? {
            if (!value.startsWith("wallet-bound-")) return null
            require(value.startsWith(PREFIX))
            val fields = value.removePrefix(PREFIX).split(':')
            require(fields.size == 2 && uuid.matches(fields[0]) && ingestToken.matches(fields[1]))
            return WalletBoundCredential(fields[1], fields[0].lowercase(Locale.ROOT))
        }
    }
}
