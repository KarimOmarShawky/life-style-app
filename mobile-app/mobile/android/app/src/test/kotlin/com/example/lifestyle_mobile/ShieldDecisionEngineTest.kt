package com.example.lifestyle_mobile

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ShieldDecisionEngineTest {
    private val engine = ShieldDecisionEngine()
    private val state = ShieldSessionState(active = true, endTimestampMs = 100000,
        blockedPackages = setOf("social", "keyboard", "home") + ShieldDecisionEngine.SAFE_PACKAGES,
        allowlistedPackages = setOf("keyboard", "home"))

    @Test fun blocksOnlySelectedApps() {
        assertTrue(engine.shouldBlock("social", 2000, state, null))
        assertFalse(engine.shouldBlock("other", 2000, state, null))
    }
    @Test fun inactiveAndExactExpiryAlwaysAllow() {
        assertFalse(engine.shouldBlock("social", 2000, state.copy(active = false), null))
        assertFalse(engine.shouldBlock("social", 100000, state, null))
        assertFalse(engine.shouldBlock("social", 100001, state, null))
    }
    @Test fun safePackagesCannotBeBlockedEvenIfSelected() {
        for (pkg in ShieldDecisionEngine.SAFE_PACKAGES + state.allowlistedPackages) {
            assertFalse(pkg, engine.shouldBlock(pkg, 2000, state, null))
        }
    }
    @Test fun bypassIsSinglePackageAndExpiresAtBoundary() {
        val bypass = state.copy(tempBypassPackage = "social", tempBypassUntilMs = 62000,
            blockedPackages = state.blockedPackages + "another")
        assertFalse(engine.shouldBlock("social", 61999, bypass, null))
        assertTrue(engine.shouldBlock("social", 62000, bypass, null))
        assertTrue(engine.shouldBlock("another", 2000, bypass, null))
    }
    @Test fun debounceBoundaryAndBackwardsClock() {
        assertFalse(engine.shouldBlock("social", 2499, state, 1000))
        assertTrue(engine.shouldBlock("social", 2500, state, 1000))
        assertTrue(engine.shouldBlock("social", 900, state, 1000))
    }
}
