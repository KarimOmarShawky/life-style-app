package com.example.lifestyle_mobile

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent

class FocusShieldAccessibilityService : AccessibilityService() {
    private val engine = ShieldDecisionEngine()
    private val lastEvents = mutableMapOf<String, Long>()
    private var sessionId: String? = null
    override fun onServiceConnected() { FocusShieldSessionStore(this).current() }
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val store = FocusShieldSessionStore(this)
        val state = store.current() // Includes expiry, even for events we ignore.
        if (!state.active) { lastEvents.clear(); return }
        if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val packageName = event.packageName?.toString() ?: return
        val currentId = store.snapshot()["sessionId"] as String
        if (sessionId != currentId) { lastEvents.clear(); sessionId = currentId }
        val now = System.currentTimeMillis()
        if (!engine.shouldBlock(packageName, now, state, lastEvents[packageName])) return
        lastEvents[packageName] = now
        val snapshot = store.recordAttempt()
        FocusShieldEvents.emit(snapshot + mapOf("type" to "intercept", "packageName" to packageName))
        performGlobalAction(GLOBAL_ACTION_HOME)
        try {
            startActivity(FocusShieldSessionStore.focusIntent(this)
                .putExtra("focusInterceptPackage", packageName))
        } catch (_: RuntimeException) { /* HOME already provided the safe exit. Never loop or crash. */ }
    }
    override fun onInterrupt() { lastEvents.clear() }
}
