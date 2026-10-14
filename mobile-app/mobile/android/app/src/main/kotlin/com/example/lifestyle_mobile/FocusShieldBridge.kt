package com.example.lifestyle_mobile

import android.Manifest
import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel

class FocusShieldBridge(private val activity: MainActivity, messenger: BinaryMessenger) {
    private val store = FocusShieldSessionStore(activity)
    private var notificationPermissionResult: MethodChannel.Result? = null
    private val methods = MethodChannel(messenger, CHANNEL)
    private val events = EventChannel(messenger, "$CHANNEL/events")
    init {
        events.setStreamHandler(object : EventChannel.StreamHandler {
            override fun onListen(arguments: Any?, sink: EventChannel.EventSink) {
                if ((arguments as? Map<*, *>)?.get("schemaVersion") != 1) {
                    sink.error("SCHEMA_VERSION", "Unsupported Focus Shield schema", null)
                    return
                }
                val snapshot = store.snapshot()
                FocusShieldEvents.attach(sink, snapshot["sessionId"] as String, snapshot["active"] as Boolean)
            }
            override fun onCancel(arguments: Any?) { FocusShieldEvents.detach() }
        })
        methods.setMethodCallHandler { call, result ->
            if (call.argument<Int>("schemaVersion") != 1) {
                result.error("SCHEMA_VERSION", "Unsupported Focus Shield schema", null)
                return@setMethodCallHandler
            }
            try {
                when (call.method) {
                    "getPermissionStatus" -> {
                        if (call.argument<Boolean>("requestNotifications") == true && Build.VERSION.SDK_INT >= 33 &&
                            activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                            if (notificationPermissionResult != null) {
                                result.error("BUSY", "A permission request is already open", null)
                            } else {
                                notificationPermissionResult = result
                                activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
                            }
                        } else result.success(permissionStatus())
                    }
                    "openAccessibilitySettings" -> { activity.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)); result.success(ok()) }
                    "openNotificationListenerSettings" -> { activity.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)); result.success(ok()) }
                    "openBatteryOptimizationSettings" -> { activity.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)); result.success(ok()) }
                    "getShieldState" -> result.success(store.snapshot())
                    "startShield" -> {
                        check(permissionStatus()["accessibility"] == true) { "Accessibility permission required" }
                        store.start(requireNotNull(call.argument<String>("sessionId")), call.argument<String>("taskTitle") ?: "Focus",
                            requireNotNull(call.argument<Number>("endTimestampMs")).toLong(),
                            call.argument<List<String>>("blockedPackages")?.toSet() ?: emptySet())
                        result.success(store.snapshot())
                    }
                    "stopShield" -> {
                        val requested = call.argument<String>("reason")
                        val reason = if (requested == "completed" || requested == "cancelled") requested else "manual"
                        store.stop(reason); result.success(store.snapshot())
                    }
                    "grantTemporaryBypass" -> {
                        val pkg = requireNotNull(call.argument<String>("packageName"))
                        val launch = requireNotNull(activity.packageManager.getLaunchIntentForPackage(pkg)) { "App cannot be opened" }
                        store.grantTemporaryBypass(pkg)
                        activity.startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                        result.success(store.snapshot())
                    }
                    "getInstalledApps" -> {
                        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
                        val apps = activity.packageManager.queryIntentActivities(intent, 0)
                            .distinctBy { it.activityInfo.packageName }.map {
                                mapOf("packageName" to it.activityInfo.packageName,
                                    "label" to it.loadLabel(activity.packageManager).toString())
                            }.sortedBy { it["label"] }
                        result.success(ok() + ("apps" to apps))
                    }
                    // Phase 3/5 register these implementations without changing the contract.
                    "sendReply" -> result.success(ok() + ("result" to "noReplyAction"))
                    "updateHomeWidget" -> result.success(ok())
                    else -> result.notImplemented()
                }
            } catch (_: Exception) {
                // Never include user content in error messages or logs.
                result.error("FOCUS_SHIELD_UNAVAILABLE", "Focus Shield action is unavailable. Check Android settings.", null)
            }
        }
    }
    fun onPermissionResult(requestCode: Int) {
        if (requestCode == REQUEST_NOTIFICATIONS) {
            notificationPermissionResult?.success(permissionStatus())
            notificationPermissionResult = null
        }
    }
    private fun permissionStatus(): Map<String, Any?> {
        fun enabled(setting: String, className: String): Boolean {
            val expected = ComponentName(activity, className)
            return Settings.Secure.getString(activity.contentResolver, setting)?.split(':')
                ?.any { ComponentName.unflattenFromString(it) == expected } == true
        }
        return ok() + mapOf(
            "accessibility" to enabled(Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, FocusShieldAccessibilityService::class.java.name),
            "notificationListener" to enabled("enabled_notification_listeners", "com.example.lifestyle_mobile.FocusNotificationListenerService"),
            "notifications" to (Build.VERSION.SDK_INT < 33 || activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED),
        )
    }
    fun close() {
        notificationPermissionResult?.error("ACTIVITY_CLOSED", "Activity closed", null)
        notificationPermissionResult = null
        methods.setMethodCallHandler(null)
        events.setStreamHandler(null)
        FocusShieldEvents.detach()
    }
    companion object {
        const val CHANNEL = "com.example.lifestyle_mobile/focus_shield"
        const val REQUEST_NOTIFICATIONS = 4403
        fun ok(): Map<String, Any?> = mapOf("schemaVersion" to 1)
    }
}
