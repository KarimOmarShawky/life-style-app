package com.example.lifestyle_mobile

import org.junit.Assert.*
import org.junit.Test

class BoundedMemoryCacheTest {
    @Test fun evictsOldestAtOneHundredAndClearsWithoutPersistence() {
        val cache = BoundedMemoryCache<String, String>()
        for (i in 0 until 100) assertNull(cache.put("$i", "memory-$i"))
        assertEquals("0", cache.put("100", "memory-100"))
        assertNull(cache.get("0"))
        assertEquals(100, cache.size())
        assertEquals("memory-100", cache.remove("100"))
        assertNull(cache.get("100"))
        cache.clear()
        assertEquals(0, cache.size())
    }
    @Test fun updatingSameKeyDoesNotGrowCacheOrEvictItself() {
        val cache = BoundedMemoryCache<String, Int>(2)
        cache.put("a", 1); cache.put("b", 2); cache.put("a", 3)
        assertEquals("b", cache.put("c", 4))
        assertEquals(3, cache.get("a"))
        assertNull(cache.get("b"))
    }
    @Test fun concurrentWritersCannotExceedCapacity() {
        val cache = BoundedMemoryCache<Int, Int>()
        val threads = (0 until 8).map { worker -> Thread { for (i in 0 until 200) cache.put(worker * 200 + i, i) } }
        threads.forEach { it.start() }; threads.forEach { it.join() }
        assertEquals(100, cache.size())
    }
}
