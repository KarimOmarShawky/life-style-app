package com.example.lifestyle_mobile

/** Pure policy: no Android objects, clocks, preferences or side effects. */
data class ShieldSessionState(
    val active: Boolean = false,
    val endTimestampMs: Long = 0,
    val blockedPackages: Set<String> = emptySet(),
    val allowlistedPackages: Set<String> = emptySet(),
    val tempBypassPackage: String? = null,
    val tempBypassUntilMs: Long = 0,
)

class ShieldDecisionEngine {
    fun shouldBlock(packageName: String, nowMs: Long, sessionState: ShieldSessionState, lastEventMs: Long?): Boolean {
        if (!sessionState.active || nowMs >= sessionState.endTimestampMs) return false
        if (packageName in SAFE_PACKAGES || packageName in sessionState.allowlistedPackages) return false
        if (packageName == sessionState.tempBypassPackage && nowMs < sessionState.tempBypassUntilMs) return false
        if (packageName !in sessionState.blockedPackages) return false
        if (lastEventMs != null && nowMs - lastEventMs in 0 until DEBOUNCE_MS) return false
        return true
    }

    companion object {
        const val DEBOUNCE_MS = 1500L
        val SAFE_PACKAGES = setOf(
            "com.example.lifestyle_mobile", "com.lifestyle.app", "com.android.systemui", "com.android.settings",
            "com.android.phone", "com.android.server.telecom", "com.android.dialer", "com.google.android.dialer",
            "com.samsung.android.dialer", "com.samsung.android.incallui", "com.android.incallui",
            "com.android.emergency", "com.google.android.apps.safetyhub", "com.samsung.android.app.telephonyui",
            "com.google.android.permissioncontroller", "com.android.permissioncontroller",
            "com.google.android.packageinstaller", "com.android.packageinstaller",
        )
    }
}
