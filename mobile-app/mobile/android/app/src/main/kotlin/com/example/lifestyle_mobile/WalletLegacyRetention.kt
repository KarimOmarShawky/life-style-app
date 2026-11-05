package com.example.lifestyle_mobile

/**
 * Until authenticated item ownership exists, an aged or undated legacy SMS
 * entry must be held in place, not automatically deleted or recovered. This
 * is not a general ownerless-record lock: recent entries still use legacy paths.
 */
internal object WalletLegacyRetention {
    const val WINDOW_MS = 7L * 24 * 60 * 60 * 1000L
    fun hold(timestampMs: Long, nowMs: Long): Boolean =
        timestampMs <= 0L || timestampMs < nowMs - WINDOW_MS
}
