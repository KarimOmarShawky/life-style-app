package com.example.lifestyle_mobile

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FocusMessageSourcesTest {
    @Test
    fun `accepts only supported non SMS messaging packages`() {
        listOf("com.whatsapp", "com.instagram.android", "com.facebook.orca", "org.telegram.messenger")
            .forEach { assertTrue(it, FocusMessageSources.isSupported(it)) }
        listOf("com.google.android.apps.messaging", "com.android.mms", "com.samsung.android.messaging", "com.other.sms", "")
            .forEach { assertFalse(it, FocusMessageSources.isSupported(it)) }
    }
}
