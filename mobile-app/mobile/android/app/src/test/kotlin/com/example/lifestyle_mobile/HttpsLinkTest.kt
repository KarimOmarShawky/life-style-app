package com.example.lifestyle_mobile

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HttpsLinkTest {
    @Test
    fun `accepts a published https document`() {
        assertTrue(HttpsLink.isOpenable("https://docs.google.com/document/d/e/2PACX-1vT/pub"))
        assertTrue(HttpsLink.isOpenable("HTTPS://example.com/privacy?lang=ar#top"))
    }

    @Test
    fun `rejects other schemes and relative or empty links`() {
        for (link in listOf(
            null, "", "http://example.com/privacy", "intent://scan/#Intent;scheme=zxing;end",
            "javascript:alert(1)", "file:///data/data/x", "content://x/y", "mailto:a@example.com",
            "//example.com/privacy", "/privacy", "https:///privacy", "https://"
        )) {
            assertFalse("should reject $link", HttpsLink.isOpenable(link))
        }
    }

    @Test
    fun `rejects user info, whitespace, control characters and very long links`() {
        assertFalse(HttpsLink.isOpenable("https://someone@example.com/privacy"))
        assertFalse(HttpsLink.isOpenable(" https://example.com/privacy"))
        assertFalse(HttpsLink.isOpenable("https://example.com/pri vacy"))
        assertFalse(HttpsLink.isOpenable("https://example.com/\nprivacy"))
        assertFalse(HttpsLink.isOpenable("https://example.com/" + "a".repeat(2048)))
    }
}
