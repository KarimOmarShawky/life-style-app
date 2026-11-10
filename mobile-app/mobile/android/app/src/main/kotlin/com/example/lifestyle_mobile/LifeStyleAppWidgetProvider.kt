package com.example.lifestyle_mobile

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Zero plugin/dependency widget. Never caches notification content or actions. */
class LifeStyleAppWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) { updateAll(context) }
    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        val action = intent.action
        if (action == Intent.ACTION_BOOT_COMPLETED) FocusShieldSessionStore(context).stop("reboot")
        if (action != null && action in REDRAW_ACTIONS) updateAll(context)
    }
    companion object {
        const val SHIELD_CHANGED = "com.example.lifestyle_mobile.SHIELD_CHANGED"
        private const val PREFS = "lifestyle_widget_prefs"
        // Redraw from stored data: the shield changed, the device language changed (when the widget follows it),
        // or the clock moved, which can expire the day's task snapshot.
        private val REDRAW_ACTIONS = setOf(
            SHIELD_CHANGED, Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_LOCALE_CHANGED,
            Intent.ACTION_TIME_CHANGED, Intent.ACTION_TIMEZONE_CHANGED
        )
        private val TASK_LINES = intArrayOf(R.id.widget_task_1, R.id.widget_task_2, R.id.widget_task_3)
        private fun today(): String = SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(Date())
        fun saveDisplayData(context: Context, data: Map<*, *>) {
            val edit = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            if (data.containsKey("clarityScore")) edit.putInt("clarityScore", (data["clarityScore"] as? Number)?.toInt()?.coerceIn(0, 100) ?: -1)
            if (data.containsKey("level")) edit.putInt("level", (data["level"] as? Number)?.toInt()?.coerceAtLeast(1) ?: 1)
            if (data.containsKey("xp")) edit.putLong("xp", (data["xp"] as? Number)?.toLong()?.coerceAtLeast(0) ?: 0)
            if (data.containsKey("pendingTasksCount")) {
                edit.putInt("pendingTasksCount", (data["pendingTasksCount"] as? Number)?.toInt()?.coerceAtLeast(0) ?: 0)
                edit.putString("taskSnapshotDate", today())
            }
            if (data.containsKey("topTaskTitles") || data.containsKey("topTaskTitle")) {
                val raw = if (data.containsKey("topTaskTitles")) data["topTaskTitles"] else data["topTaskTitle"]
                edit.putString("topTaskTitles", WidgetContent.encode(WidgetContent.titles(raw)))
                edit.remove("topTaskTitle")
            }
            if (data.containsKey("locale")) edit.putString("locale", WidgetContent.language(data["locale"]) ?: "")
            edit.apply()
            updateAll(context)
        }
        /** Resources in the app's chosen language; without a choice, the device language (default resources). */
        private fun displayContext(context: Context, language: String?): Context {
            if (language == null) return context
            val configuration = Configuration(context.resources.configuration)
            configuration.setLocale(Locale.forLanguageTag(language))
            return context.createConfigurationContext(configuration)
        }
        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, LifeStyleAppWidgetProvider::class.java))
            // Always expire native state, even when this update is not from Flutter.
            val active = FocusShieldSessionStore(context).current().active
            if (ids.isEmpty()) return
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val text = displayContext(context, WidgetContent.language(prefs.getString("locale", "")))
            val score = prefs.getInt("clarityScore", -1)
            val currentDay = prefs.getString("taskSnapshotDate", "") == today()
            val storedTitles = prefs.getString("topTaskTitles", null) ?: prefs.getString("topTaskTitle", null)
            val lines = WidgetContent.taskLines(
                currentDay, WidgetContent.decode(storedTitles),
                text.getString(R.string.widget_tasks_empty), text.getString(R.string.widget_refresh_hint)
            )
            for (id in ids) {
                val view = RemoteViews(context.packageName, R.layout.lifestyle_widget)
                view.setTextViewText(R.id.widget_header, text.getString(R.string.widget_header))
                view.setTextViewText(R.id.widget_clarity, if (score < 0) text.getString(R.string.widget_no_data) else "$score / 100")
                view.setTextViewText(R.id.widget_level, text.getString(R.string.widget_level_xp, prefs.getInt("level", 1), prefs.getLong("xp", 0)))
                view.setTextViewText(R.id.widget_pending,
                    if (currentDay) text.getString(R.string.widget_tasks_left, prefs.getInt("pendingTasksCount", 0))
                    else text.getString(R.string.widget_tasks_no_data))
                TASK_LINES.forEachIndexed { index, viewId ->
                    val line = lines[index]
                    view.setViewVisibility(viewId, if (line == null) View.GONE else View.VISIBLE)
                    view.setTextViewText(viewId, line ?: "")
                }
                // Shield status is NEVER supplied or overwritten by Flutter.
                view.setTextViewText(R.id.widget_shield,
                    text.getString(if (active) R.string.widget_shield_active else R.string.widget_shield_ready))
                view.setTextViewText(R.id.widget_daily_plan, text.getString(R.string.widget_daily_plan))
                fun tap(uri: String, requestCode: Int): PendingIntent = PendingIntent.getActivity(context, requestCode,
                    Intent(context, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(Uri.parse(uri))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
                view.setOnClickPendingIntent(R.id.widget_root, tap(WidgetContent.FOCUS_URI, id))
                view.setOnClickPendingIntent(R.id.widget_daily_plan, tap(WidgetContent.DAILY_PLAN_URI, id + 100000))
                manager.updateAppWidget(id, view)
            }
        }
    }
}
