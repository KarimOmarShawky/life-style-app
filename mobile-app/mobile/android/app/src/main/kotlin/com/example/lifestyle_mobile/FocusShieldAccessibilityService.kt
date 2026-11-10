package com.example.lifestyle_mobile

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Context
import android.content.SharedPreferences
import android.view.accessibility.AccessibilityEvent
import android.os.Handler
import android.os.Looper

class FocusShieldAccessibilityService : AccessibilityService() {
    private val engine = ShieldDecisionEngine()
    private val lastEvents = mutableMapOf<String, Long>()
    private var sessionId: String? = null
    private var foregroundPackage: String? = null

    // The event path used to rebuild the session store and re-read
    // SharedPreferences (plus a ContentResolver boot-count query) for
    // every window event in every app. The state is now cached and
    // invalidated by the preferences listener the moment anything
    // (start, stop, bypass, attempt) writes it, so the hot path is a
    // field read while expiry is still evaluated from the cached
    // endTimestamp on each event.
    private var cachedState: ShieldSessionState? = null
    private val prefsListener =
        SharedPreferences.OnSharedPreferenceChangeListener { _, _ ->
            cachedState = null
        }

    private fun currentState(): ShieldSessionState =
        cachedState ?: FocusShieldSessionStore(this).current().also {
            cachedState = it
        }

    override fun onServiceConnected() {
        instance = this
        getSharedPreferences("focus_shield_prefs", Context.MODE_PRIVATE)
            .registerOnSharedPreferenceChangeListener(prefsListener)
        applyPackageFilter()
        FocusShieldSessionStore(this).current()
    }

    /**
     * Restricts window events to the session's packages (plus this app)
     * instead of every window change on the device: far fewer wakeups,
     * less battery, and a smaller footprint for OEM cleaners that watch
     * chatty accessibility services. Refreshed on connect, on session
     * change, and whenever the bridge starts a session.
     */
    internal fun applyPackageFilter() {
        val info = serviceInfo ?: return
        val packages =
            FocusShieldSessionStore(this).current().blockedPackages + packageName
        info.packageNames = packages.toTypedArray()
        info.eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
        info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
        info.notificationTimeout = 0
        serviceInfo = info
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val state = currentState()
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
        val state = currentState()
        val currentId = store.snapshot()["sessionId"] as String
        if (sessionId != currentId) {
            lastEvents.clear()
            sessionId = currentId
            applyPackageFilter()
        }
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
            getSharedPreferences("focus_shield_prefs", Context.MODE_PRIVATE)
                .unregisterOnSharedPreferenceChangeListener(prefsListener)
            // Do not report continued protection after the enforcing service
            // disconnects. An old instance must never stop a newer connection.
            try { FocusShieldSessionStore(this).stop("accessibility_lost") }
            catch (_: RuntimeException) { /* Status reconciliation will retry. */ }
        }
        super.onDestroy()
    }
    companion object {
        fun isConnected(): Boolean = instance != null

        /** Re-applies the event package filter after a bridge-side start. */
        fun refreshPackageFilter() {
            instance?.applyPackageFilter()
        }

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
