package com.example.lifestyle_mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WidgetContentTest {
    @Test
    fun `keeps at most three clean single-line titles in order`() {
        val titles = WidgetContent.titles(listOf("  Call   mom ", "", "Line\nbreak", 42, "Third", "Fourth"))
        assertEquals(listOf("Call mom", "Line break", "Third"), titles)
    }

    @Test
    fun `accepts a single title stored by older versions and rejects other data`() {
        assertEquals(listOf("Only one"), WidgetContent.titles("Only one"))
        assertEquals(emptyList<String>(), WidgetContent.titles(null))
        assertEquals(emptyList<String>(), WidgetContent.titles(7))
        assertEquals(emptyList<String>(), WidgetContent.titles(mapOf("title" to "x")))
    }

    @Test
    fun `long titles are clipped without splitting a surrogate pair`() {
        val emoji = "\uD83D\uDE00"
        val title = "a".repeat(119) + emoji + "tail"
        val clipped = WidgetContent.titles(listOf(title)).single()
        assertEquals("a".repeat(119), clipped)
        assertFalse(Character.isHighSurrogate(clipped.last()))
        assertEquals(120, WidgetContent.titles(listOf("b".repeat(500))).single().length)
    }

    @Test
    fun `stored titles round trip and empty storage means no titles`() {
        val titles = listOf("One", "Two", "Three")
        assertEquals(titles, WidgetContent.decode(WidgetContent.encode(titles)))
        assertEquals(emptyList<String>(), WidgetContent.decode(null))
        assertEquals(emptyList<String>(), WidgetContent.decode(""))
    }

    @Test
    fun `only languages with widget strings are used`() {
        listOf("ar", "de", "en", "es", "fr", "tr").forEach { assertEquals(it, WidgetContent.language(it)) }
        assertEquals("ar", WidgetContent.language(" AR "))
        assertNull(WidgetContent.language("it"))
        assertNull(WidgetContent.language(""))
        assertNull(WidgetContent.language(null))
        assertNull(WidgetContent.language(5))
    }

    @Test
    fun `task lines show next actions, the empty state or the refresh hint`() {
        assertEquals(listOf("refresh", null, null), WidgetContent.taskLines(false, listOf("A"), "empty", "refresh"))
        assertEquals(listOf("empty", null, null), WidgetContent.taskLines(true, emptyList(), "empty", "refresh"))
        assertEquals(listOf("• A", "• B", null), WidgetContent.taskLines(true, listOf("A", "B"), "empty", "refresh"))
        assertEquals(
            listOf("• A", "• B", "• C"),
            WidgetContent.taskLines(true, listOf("A", "B", "C", "D"), "empty", "refresh")
        )
    }

    @Test
    fun `links use the path form and the focus check accepts both forms`() {
        assertEquals("lifestyle:///focus", WidgetContent.FOCUS_URI)
        assertEquals("lifestyle:///daily-plan", WidgetContent.DAILY_PLAN_URI)
        assertTrue(WidgetContent.isFocusLink("lifestyle", "", "/focus"))
        assertTrue(WidgetContent.isFocusLink("lifestyle", null, "/focus/"))
        assertTrue(WidgetContent.isFocusLink("lifestyle", "focus", ""))
        assertFalse(WidgetContent.isFocusLink("lifestyle", "", "/daily-plan"))
        assertFalse(WidgetContent.isFocusLink("lifestyle", "", "/focus-extra"))
        assertFalse(WidgetContent.isFocusLink("lifestyle", "daily-plan", "/focus"))
        assertFalse(WidgetContent.isFocusLink("https", "focus", ""))
        assertFalse(WidgetContent.isFocusLink(null, null, null))
    }
}
