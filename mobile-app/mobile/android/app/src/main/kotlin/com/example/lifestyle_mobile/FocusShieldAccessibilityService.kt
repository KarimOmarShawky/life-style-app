package com.example.lifestyle_mobile

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import android.os.Handler
import android.os.Looper
import java.lang.ref.WeakReference

class FocusShieldAccessibilityService : AccessibilityService() {
    private val engine = ShieldDecisionEngine()
    private val lastEvents = mutableMapOf<String, Long>()
    private var sessionId: String? = null
    private var foregroundPackage: String? = null
    override fun onServiceConnected() {
        instance = WeakReference(this)
        FocusShieldSessionStore(this).current()
    }
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val store = FocusShieldSessionStore(this)
        val state = store.current() // Includes expiry, even for events we ignore.
        if (event?.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            foregroundPackage = event.packageName?.toString()
        }
        if (!state.active) { lastEvents.clear(); return }
        if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val packageName = foregroundPackage ?: return
        enforcePackage(packageName)
    }
    private fun enforcePackage(packageName: String) {
        val store = FocusShieldSessionStore(this)
        val state = store.current()
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
    override fun onDestroy() {
        if (instance?.get() === this) instance = null
        super.onDestroy()
    }
    companion object {
        private var instance: WeakReference<FocusShieldAccessibilityService>? = null
        private val handler = Handler(Looper.getMainLooper())
        fun scheduleBypassRecheck(packageName: String, untilMs: Long) {
            handler.postDelayed({
                val service = instance?.get()
                if (service != null && service.foregroundPackage == packageName) {
                    val state = FocusShieldSessionStore(service).current()
                    if (state.tempBypassPackage == packageName && state.tempBypassUntilMs == untilMs) service.enforcePackage(packageName)
                }
            }, (untilMs - System.currentTimeMillis()).coerceAtLeast(0))
        }
    }
}
