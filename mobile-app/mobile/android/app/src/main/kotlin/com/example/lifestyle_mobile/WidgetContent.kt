package com.example.lifestyle_mobile

/**
 * Display rules for the home-screen widget (feature guide G3). Kept free of Android types so that JVM unit
 * tests cover them; LifeStyleAppWidgetProvider only applies the results to RemoteViews.
 */
object WidgetContent {
    const val MAX_TASKS = 3
    private const val MAX_TITLE_LENGTH = 120
    private val WHITESPACE = Regex("\\s+")
    private val SUPPORTED_LANGUAGES = setOf("ar", "de", "en", "es", "fr", "tr")

    /**
     * Path-form app links. On a warm start Flutter pushes the link's path, so the old host form
     * (`lifestyle://focus`, empty path) opened the home route a second time instead of the linked screen.
     */
    const val FOCUS_URI = "lifestyle:///focus"
    const val DAILY_PLAN_URI = "lifestyle:///daily-plan"

    /** The focus link in either form, so links created by older versions keep working. */
    fun isFocusLink(scheme: String?, host: String?, path: String?): Boolean =
        scheme == "lifestyle" && (host == "focus" || (host.isNullOrEmpty() && path?.trimEnd('/') == "/focus"))

    /**
     * Up to [MAX_TASKS] single-line titles in the order given. Accepts the list sent by the app and, for
     * data stored by older versions, a single title. Anything else yields an empty list.
     */
    fun titles(raw: Any?): List<String> {
        val items: List<*> = when (raw) {
            is List<*> -> raw
            is String -> listOf(raw)
            else -> emptyList<Any>()
        }
        return items.asSequence()
            .mapNotNull { it as? String }
            .map { clip(it.replace(WHITESPACE, " ").trim()) }
            .filter { it.isNotEmpty() }
            .take(MAX_TASKS)
            .toList()
    }

    /** Titles never contain line breaks after [titles], so a newline is a safe separator. */
    fun encode(titles: List<String>): String = titles.joinToString("\n")

    fun decode(stored: String?): List<String> = if (stored.isNullOrEmpty()) emptyList() else titles(stored.split('\n'))

    /** The app's chosen language when the widget has strings for it; null means the device language. */
    fun language(raw: Any?): String? = (raw as? String)?.trim()?.lowercase()?.takeIf { it in SUPPORTED_LANGUAGES }

    /**
     * Text for each of the [MAX_TASKS] task lines; null hides a line. An expired snapshot (from an earlier
     * day) shows only the refresh hint, because yesterday's tasks are not today's next actions.
     */
    fun taskLines(currentDay: Boolean, titles: List<String>, emptyText: String, refreshText: String): List<String?> {
        val lines = when {
            !currentDay -> listOf(refreshText)
            titles.isEmpty() -> listOf(emptyText)
            else -> titles.take(MAX_TASKS).map { "• $it" }
        }
        return List(MAX_TASKS) { lines.getOrNull(it) }
    }

    private fun clip(text: String): String {
        if (text.length <= MAX_TITLE_LENGTH) return text
        // Never cut an emoji or other surrogate pair in half.
        val end = if (Character.isHighSurrogate(text[MAX_TITLE_LENGTH - 1])) MAX_TITLE_LENGTH - 1 else MAX_TITLE_LENGTH
        return text.substring(0, end)
    }
}
