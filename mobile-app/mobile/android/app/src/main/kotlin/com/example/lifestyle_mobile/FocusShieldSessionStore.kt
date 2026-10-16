package com.example.lifestyle_mobile

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import android.os.Handler
import android.os.Looper
import android.view.inputmethod.InputMethodManager
import android.telecom.TelecomManager
import androidx.core.app.NotificationCompat

/** Native authority for attempts. Persist only session/configuration metadata. */
class FocusShieldSessionStore(context: Context) {
    private val context = context.applicationContext
    private val prefs = this.context.getSharedPreferences("focus_shield_prefs", Context.MODE_PRIVATE)

    fun current(now: Long = System.currentTimeMillis()): ShieldSessionState = synchronized(lock) {
        if (prefs.getBoolean("active", false) && prefs.contains("elapsedEnd")) {
            val elapsed = SystemClock.elapsedRealtime()
            val boot = Settings.Global.getInt(context.contentResolver, "boot_count", -1)
            val expectedWall = prefs.getLong("endTimestampMs", 0) - (prefs.getLong("elapsedEnd", 0) - elapsed)
            if (boot != prefs.getInt("bootCount", -1) || elapsed < prefs.getLong("elapsedStart", 0)) {
                stop("reboot")
            } else if (kotlin.math.abs(now - expectedWall) > 120000) {
                stop("clock_changed")
            } else if (elapsed >= prefs.getLong("elapsedEnd", 0)) {
                stop("expired")
            }
        }
        if (prefs.getBoolean("active", false) && now >= prefs.getLong("endTimestampMs", 0)) stop("expired")
        ShieldSessionState(
            active = prefs.getBoolean("active", false), endTimestampMs = prefs.getLong("endTimestampMs", 0),
            blockedPackages = prefs.getStringSet("blockedPackages", emptySet())!!.toSet(),
            allowlistedPackages = safePackages(), tempBypassPackage = prefs.getString("tempBypassPackage", null),
            tempBypassUntilMs = prefs.getLong("tempBypassUntilMs", 0),
        )
    }
    fun selectedPackages(): Set<String> = prefs.getStringSet("blockedPackages", emptySet())!!.toSet()
    fun snapshot(): Map<String, Any?> {
        val state = current()
        return mapOf("schemaVersion" to 1, "active" to state.active,
            "sessionId" to prefs.getString("sessionId", ""), "taskTitle" to prefs.getString("taskTitle", ""),
            "endTimestampMs" to state.endTimestampMs, "blockedAttemptsCount" to prefs.getInt("blockedAttemptsCount", 0),
            "manualBypassesCount" to prefs.getInt("manualBypassesCount", 0), "endReason" to prefs.getString("endReason", ""))
    }
    fun start(id: String, title: String, end: Long, packages: Set<String>) = synchronized(lock) {
        require(id.isNotBlank() && end > System.currentTimeMillis() && end <= System.currentTimeMillis() + 24 * 60 * 60 * 1000) { "Invalid session duration" }
        check(!current().active) { "A shield session is already active" }
        prefs.edit().putBoolean("active", true).putString("sessionId", id).putString("taskTitle", title.take(300))
            .putLong("elapsedStart", SystemClock.elapsedRealtime())
            .putLong("elapsedEnd", SystemClock.elapsedRealtime() + end - System.currentTimeMillis())
            .putInt("bootCount", Settings.Global.getInt(context.contentResolver, "boot_count", -1))
            .putLong("endTimestampMs", end).putStringSet("blockedPackages", packages.toSet())
            .putStringSet("allowlistedPackages", safePackages()).remove("tempBypassPackage")
            .putLong("tempBypassUntilMs", 0).putInt("blockedAttemptsCount", 0)
            .putInt("manualBypassesCount", 0).putString("endReason", "").commit()
        try {
            scheduleExpiration(end)
            postNotification(end)
            refreshWidget()
        } catch (error: RuntimeException) {
            stop("failed") // Never leave active blocking behind a failed start.
            throw error
        }
    }
    fun stop(reason: String = "manual") = synchronized(lock) {
        if (!prefs.getBoolean("active", false)) return@synchronized
        prefs.edit().putBoolean("active", false).remove("tempBypassPackage").putLong("tempBypassUntilMs", 0)
            .putString("endReason", reason)
            .putInt("manualBypassesCount", prefs.getInt("manualBypassesCount", 0) + if (reason == "manual") 1 else 0).commit()
        expiryHandler.removeCallbacksAndMessages(null)
        (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(expiryIntent())
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(NOTIFICATION_ID)
        FocusShieldEvents.endSession()
        refreshWidget()
        FocusShieldEvents.emit(snapshotWithoutExpiry() + mapOf("type" to "stopped", "reason" to reason))
    }
    private fun snapshotWithoutExpiry(): Map<String, Any?> = mapOf(
        "active" to false, "sessionId" to prefs.getString("sessionId", ""),
        "taskTitle" to prefs.getString("taskTitle", ""), "endTimestampMs" to prefs.getLong("endTimestampMs", 0),
        "blockedAttemptsCount" to prefs.getInt("blockedAttemptsCount", 0))

    // Notification callbacks on older Android releases may run off main. Capture
    // and session teardown share the lock, so nothing can re-enter the cache
    // after endSession has cleared it.
    fun <T> withActiveSession(operation: (String) -> T): T? = synchronized(lock) {
        if (!current().active) return@synchronized null
        operation(prefs.getString("sessionId", "")!!)
    }

    fun recordAttempt(): Map<String, Any?> = synchronized(lock) {
        if (current().active) prefs.edit().putInt("blockedAttemptsCount", prefs.getInt("blockedAttemptsCount", 0) + 1).commit()
        snapshot()
    }
    fun grantTemporaryBypass(packageName: String) = synchronized(lock) {
        check(current().active) { "No active session" }
        val until = System.currentTimeMillis() + 60000
        prefs.edit().putString("tempBypassPackage", packageName)
            .putLong("tempBypassUntilMs", until)
            .putInt("manualBypassesCount", prefs.getInt("manualBypassesCount", 0) + 1).commit()
        FocusShieldAccessibilityService.scheduleBypassRecheck(packageName, until)
    }
    fun safePackages(): Set<String> {
        val packages = ShieldDecisionEngine.SAFE_PACKAGES.toMutableSet()
        packages.add(context.packageName) // Actual applicationId differs from Kotlin namespace.
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        context.packageManager.resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName?.let(packages::add)
        (context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).inputMethodList.forEach { packages.add(it.packageName) }
        (context.getSystemService(Context.TELECOM_SERVICE) as? TelecomManager)?.defaultDialerPackage?.let(packages::add)
        return packages
    }
    private fun expiryIntent(): PendingIntent = PendingIntent.getBroadcast(context, 4402,
        Intent(context, FocusShieldStopReceiver::class.java).setAction(ACTION_EXPIRE),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    private fun scheduleExpiration(end: Long) {
        val alarm = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        if (Build.VERSION.SDK_INT < 31 || alarm.canScheduleExactAlarms()) {
            try {
                alarm.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, end, expiryIntent())
            } catch (_: SecurityException) {
                alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, end, expiryIntent())
            }
        } else {
            // Safety is still enforced synchronously on EVERY service event.
            alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, end, expiryIntent())
        }
        expiryHandler.removeCallbacksAndMessages(null)
        expiryHandler.postDelayed({ current(); refreshWidget() }, (end - System.currentTimeMillis()).coerceAtLeast(0))
    }
    private fun postNotification(end: Long) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(
            "focus_shield", "Focus Shield safety controls", NotificationManager.IMPORTANCE_LOW))
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val open = PendingIntent.getActivity(context, 4400, focusIntent(context), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getBroadcast(context, 4401, Intent(context, FocusShieldStopReceiver::class.java)
            .setAction(ACTION_STOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, "focus_shield").setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Focus Shield is active").setContentText("You can end the shield at any time.")
            .setOngoing(true).setContentIntent(open).setTimeoutAfter((end - System.currentTimeMillis()).coerceAtLeast(1))
            .addAction(0, "End Shield Now", stop).build()
        try { manager.notify(NOTIFICATION_ID, notification) } catch (_: SecurityException) { /* Screen exit remains available. */ }
    }
    // Native events update the widget without a running Flutter engine.
    private fun refreshWidget() {
        context.sendBroadcast(Intent(context, LifeStyleAppWidgetProvider::class.java).setAction(LifeStyleAppWidgetProvider.SHIELD_CHANGED))
    }
    companion object {
        private val lock = Any()
        private val expiryHandler = Handler(Looper.getMainLooper())
        const val ACTION_EXPIRE = "com.example.lifestyle_mobile.SHIELD_EXPIRE"
        const val ACTION_STOP = "com.example.lifestyle_mobile.SHIELD_STOP"
        const val NOTIFICATION_ID = 4400
        fun focusIntent(context: Context): Intent = Intent(context, MainActivity::class.java)
            .setAction(Intent.ACTION_VIEW).setData(Uri.parse("lifestyle://focus"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
}
