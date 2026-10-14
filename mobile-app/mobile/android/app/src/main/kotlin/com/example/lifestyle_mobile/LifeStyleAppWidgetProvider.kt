package com.example.lifestyle_mobile

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Zero plugin/dependency widget. Never caches notification content or actions. */
class LifeStyleAppWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) { updateAll(context) }
    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) FocusShieldSessionStore(context).stop("reboot")
        if (intent.action == SHIELD_CHANGED || intent.action == Intent.ACTION_BOOT_COMPLETED) updateAll(context)
    }
    companion object {
        const val SHIELD_CHANGED = "com.example.lifestyle_mobile.SHIELD_CHANGED"
        private fun today(): String = SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(Date())
        fun saveDisplayData(context: Context, data: Map<*, *>) {
            val edit = context.getSharedPreferences("lifestyle_widget_prefs", Context.MODE_PRIVATE).edit()
            if (data.containsKey("clarityScore")) edit.putInt("clarityScore", (data["clarityScore"] as? Number)?.toInt()?.coerceIn(0, 100) ?: -1)
            if (data.containsKey("level")) edit.putInt("level", (data["level"] as? Number)?.toInt()?.coerceAtLeast(1) ?: 1)
            if (data.containsKey("xp")) edit.putLong("xp", (data["xp"] as? Number)?.toLong()?.coerceAtLeast(0) ?: 0)
            if (data.containsKey("pendingTasksCount")) {
                edit.putInt("pendingTasksCount", (data["pendingTasksCount"] as? Number)?.toInt()?.coerceAtLeast(0) ?: 0)
                edit.putString("taskSnapshotDate", today())
            }
            if (data.containsKey("topTaskTitle")) edit.putString("topTaskTitle", (data["topTaskTitle"] as? String)?.take(300) ?: "")
            edit.apply()
            updateAll(context)
        }
        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, LifeStyleAppWidgetProvider::class.java))
            // Always expire native state, even when this update is not from Flutter.
            val active = FocusShieldSessionStore(context).current().active
            if (ids.isEmpty()) return
            val prefs = context.getSharedPreferences("lifestyle_widget_prefs", Context.MODE_PRIVATE)
            val score = prefs.getInt("clarityScore", -1)
            val currentDay = prefs.getString("taskSnapshotDate", "") == today()
            for (id in ids) {
                val view = RemoteViews(context.packageName, R.layout.lifestyle_widget)
                view.setTextViewText(R.id.widget_clarity, if (score < 0) "No data" else "$score / 100")
                view.setTextViewText(R.id.widget_level, "Lv.${prefs.getInt("level", 1)} · ${prefs.getLong("xp", 0)} XP")
                view.setTextViewText(R.id.widget_pending, if (currentDay) "${prefs.getInt("pendingTasksCount", 0)} tasks left today" else "Today's tasks: No data")
                view.setTextViewText(R.id.widget_top_task, if (currentDay) prefs.getString("topTaskTitle", "").orEmpty().ifBlank { "Choose your next priority" } else "Open Daily Plan to refresh")
                // Shield status is NEVER supplied or overwritten by Flutter.
                view.setTextViewText(R.id.widget_shield, if (active) "Focus Shield: ACTIVE" else "Ready to Focus")
                fun tap(route: String, requestCode: Int): PendingIntent = PendingIntent.getActivity(context, requestCode,
                    Intent(context, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(Uri.parse("lifestyle://$route"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
                view.setOnClickPendingIntent(R.id.widget_root, tap("focus", id))
                view.setOnClickPendingIntent(R.id.widget_daily_plan, tap("daily-plan", id + 100000))
                manager.updateAppWidget(id, view)
            }
        }
    }
}
