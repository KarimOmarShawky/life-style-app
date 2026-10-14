package com.example.lifestyle_mobile

import java.util.concurrent.ConcurrentHashMap

/** In-memory only; synchronized ordering makes eviction atomic with updates. */
class BoundedMemoryCache<K : Any, V : Any>(private val capacity: Int = 100) {
    private val entries = ConcurrentHashMap<K, V>()
    private val order = ArrayDeque<K>()
    init { require(capacity > 0) }
    @Synchronized fun put(key: K, value: V): K? {
        order.remove(key)
        entries[key] = value
        order.addLast(key)
        if (order.size <= capacity) return null
        val evicted = order.removeFirst()
        entries.remove(evicted)
        return evicted
    }
    @Synchronized fun get(key: K): V? = entries[key]
    @Synchronized fun remove(key: K): V? { order.remove(key); return entries.remove(key) }
    @Synchronized fun clear() { entries.clear(); order.clear() }
    @Synchronized fun size(): Int = entries.size
}
