package com.example.lifestyle_mobile

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import android.os.Handler
import android.os.Looper

class FocusShieldAccessibilityService : AccessibilityService() {
    private val engine = ShieldDecisionEngine()
    private val lastEvents = mutableMapOf<String, Long>()
    private var sessionId: String? = null
    private var foregroundPackage: String? = null
    override fun onServiceConnected() {
        instance = this
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
        if (!engine.shouldBlock(packageName, now, state, lastEvents[packageName])) {
            // Debounce counting/navigation, not safety: a rapid second launch
            // must not remain in a blocked app until another window event.
            if (engine.shouldBlock(packageName, now, state, null)) performGlobalAction(GLOBAL_ACTION_HOME)
            return
        }
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
        if (instance === this) {
            instance = null
            // Do not report continued protection after the enforcing service
            // disconnects. An old instance must never stop a newer connection.
            try { FocusShieldSessionStore(this).stop("accessibility_lost") }
            catch (_: RuntimeException) { /* Status reconciliation will retry. */ }
        }
        super.onDestroy()
    }
    companion object {
        fun isConnected(): Boolean = instance != null

        // Deliberately a STRONG reference: the system keeps a bound
        // accessibility service alive through its binder, which does not
        // stop the garbage collector from clearing a weak reference to the
        // Java object. With a weak reference, isConnected() could report
        // false while the service was still bound and enforcing — and the
        // status reconciler then stopped live sessions seconds after they
        // started (seen on memory-aggressive OEM builds). The reference
        // is cleared in onDestroy, so this cannot leak a dead service.
        @Volatile
        private var instance: FocusShieldAccessibilityService? = null
        private val handler = Handler(Looper.getMainLooper())
        fun scheduleBypassRecheck(packageName: String, untilMs: Long) {
            handler.postDelayed({
                val service = instance
                if (service != null && service.foregroundPackage == packageName) {
                    val state = FocusShieldSessionStore(service).current()
                    if (state.tempBypassPackage == packageName && state.tempBypassUntilMs == untilMs) service.enforcePackage(packageName)
                }
            }, (untilMs - System.currentTimeMillis()).coerceAtLeast(0))
        }
    }
}
