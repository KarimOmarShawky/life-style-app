package com.example.lifestyle_mobile

import java.net.URI
import java.net.URISyntaxException

/**
 * Gate for links the app hands to the browser (the Play-required privacy
 * policy). Only a plain absolute https URL passes: no other scheme (such as
 * intent:, file: or javascript:), no user info, no whitespace or control
 * characters, and a bounded length. Pure JVM so it is unit-tested.
 */
object HttpsLink {
    private const val MAX_LENGTH = 2048

    fun isOpenable(raw: String?): Boolean {
        if (raw == null || raw.isEmpty() || raw.length > MAX_LENGTH) return false
        if (raw.any { it.isWhitespace() || it.isISOControl() }) return false
        val uri = try {
            URI(raw)
        } catch (_: URISyntaxException) {
            return false
        }
        return uri.isAbsolute &&
            uri.scheme.equals("https", ignoreCase = true) &&
            !uri.host.isNullOrEmpty() &&
            uri.rawUserInfo == null
    }
}
