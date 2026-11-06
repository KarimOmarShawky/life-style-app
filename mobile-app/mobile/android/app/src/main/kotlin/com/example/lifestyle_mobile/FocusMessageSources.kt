package com.example.lifestyle_mobile

/** Focus inbox accepts only these non-SMS messaging apps, never SMS apps. */
internal object FocusMessageSources {
    private val supported = setOf(
        "com.whatsapp", "com.whatsapp.w4b", "com.instagram.android", "com.instagram.lite",
        "com.facebook.orca", "com.facebook.mlite", "org.telegram.messenger", "org.telegram.messenger.web"
    )

    fun isSupported(packageName: String): Boolean = packageName in supported
}
