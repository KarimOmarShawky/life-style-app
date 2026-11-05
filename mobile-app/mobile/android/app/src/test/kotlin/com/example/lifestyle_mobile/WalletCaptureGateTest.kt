package com.example.lifestyle_mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

class WalletCaptureGateTest {
    private val ownerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    private val ownerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    private fun credential(owner: String) = WalletBoundCredential.decode(
        WalletBoundCredential.encode("lsi_" + "a".repeat(43), owner)
    )!!

    @Test fun startsInactiveAndRestartDoesNotRestoreAuthority() {
        val oldGate = WalletCaptureGate()
        assertNull(oldGate.reserve())
        assertTrue(oldGate.activate(oldGate.beginActivation(), credential(ownerA)))
        assertTrue(oldGate.capture(oldGate.reserve()!!) { assertEquals(ownerA, it.ownerId) })
        val restarted = WalletCaptureGate()
        assertNull(restarted.reserve())
    }

    @Test fun invalidationAndSwitchRejectStaleOrReusedActivation() {
        val gate = WalletCaptureGate()
        val stale = gate.beginActivation()
        gate.invalidate()
        assertFalse(gate.activate(stale, credential(ownerA)))
        assertNull(gate.reserve())
        val attemptA = gate.beginActivation()
        val attemptB = gate.beginActivation()
        val foreign = WalletCaptureGate().beginActivation()
        assertFalse(gate.activate(foreign, credential(ownerA)))
        assertFalse(gate.activate(attemptA, credential(ownerA)))
        assertTrue(gate.activate(attemptB, credential(ownerB)))
        assertFalse(gate.activate(attemptB, credential(ownerA)))
        assertTrue(gate.capture(gate.reserve()!!) { assertEquals(ownerB, it.ownerId) })
        gate.invalidate()
        assertNull(gate.reserve())
    }

    @Test fun delayedCaptureIsNotAssignedToReplacementAccount() {
        val gate = WalletCaptureGate()
        val a = credential(ownerA)
        assertTrue(gate.activate(gate.beginActivation(), a))
        val old = gate.reserve()!!
        gate.invalidate()
        assertTrue(gate.activate(gate.beginActivation(), credential(ownerB)))
        assertFalse(gate.capture(old) { fail("A reservation must not run under B") })
        // Even reactivating the exact same credential object is a new session.
        assertTrue(gate.activate(gate.beginActivation(), a))
        assertFalse(gate.capture(old) { fail("old session must remain stale") })
        val fresh = gate.reserve()!!
        assertTrue(gate.capture(fresh) { assertEquals(ownerA, it.ownerId) })
        assertFalse(gate.capture(fresh) { fail("reservation is single-use") })
    }

    @Test fun foreignAndForgedReservationsCannotCapture() {
        val a = credential(ownerA)
        val gate = WalletCaptureGate()
        val other = WalletCaptureGate()
        assertTrue(gate.activate(gate.beginActivation(), a))
        assertTrue(other.activate(other.beginActivation(), a))
        val reservation = gate.reserve()!!
        assertFalse(other.capture(reservation) { fail("foreign gate reservation") })
        assertFalse(gate.capture(object : WalletCaptureGate.Reservation {}) {
            fail("forged reservation")
        })
        assertTrue(gate.capture(reservation) { assertEquals(ownerA, it.ownerId) })
    }

    @Test fun transitionWaitsForCaptureAndLaterCaptureCannotUseOldOwner() {
        val gate = WalletCaptureGate()
        assertTrue(gate.activate(gate.beginActivation(), credential(ownerA)))
        val reserved = gate.reserve()!!
        val pool = Executors.newFixedThreadPool(2)
        val writing = CountDownLatch(1)
        val release = CountDownLatch(1)
        val transitionStarted = CountDownLatch(1)
        try {
            val capture = pool.submit<Boolean> {
                gate.capture(reserved) {
                    assertEquals(ownerA, it.ownerId)
                    writing.countDown()
                    check(release.await(5, TimeUnit.SECONDS))
                }
            }
            assertTrue(writing.await(5, TimeUnit.SECONDS))
            val transition = pool.submit {
                transitionStarted.countDown()
                gate.invalidate()
            }
            assertTrue(transitionStarted.await(5, TimeUnit.SECONDS))
            try {
                transition.get(100, TimeUnit.MILLISECONDS)
                fail("invalidation cannot pass an in-progress capture")
            } catch (_: TimeoutException) {
                // The capture callback owns the ordering lock.
            }
            release.countDown()
            assertTrue(capture.get(5, TimeUnit.SECONDS))
            transition.get(5, TimeUnit.SECONDS)
            assertNull(gate.reserve())
            assertTrue(gate.activate(gate.beginActivation(), credential(ownerB)))
            assertTrue(gate.capture(gate.reserve()!!) { assertEquals(ownerB, it.ownerId) })
        } finally {
            release.countDown()
            pool.shutdownNow()
        }
    }

    @Test fun failedWriteIsPropagatedAndReservationCannotBeReused() {
        val gate = WalletCaptureGate()
        assertTrue(gate.activate(gate.beginActivation(), credential(ownerA)))
        val reservation = gate.reserve()!!
        try {
            gate.capture(reservation) { throw IllegalStateException("storage failed") }
            fail("write failure must propagate")
        } catch (e: IllegalStateException) {
            assertEquals("storage failed", e.message)
        }
        assertFalse(gate.capture(reservation) { fail("failed write cannot be silently replayed") })
        gate.invalidate()
        assertNull(gate.reserve())
    }

    @Test fun callbackCannotReenterToChangeOrCaptureSession() {
        val gate = WalletCaptureGate()
        assertTrue(gate.activate(gate.beginActivation(), credential(ownerA)))
        val reservation = gate.reserve()!!
        assertTrue(gate.capture(reservation) {
            var rejected = 0
            try { gate.invalidate() } catch (_: IllegalStateException) { rejected++ }
            try { gate.beginActivation() } catch (_: IllegalStateException) { rejected++ }
            try { gate.reserve() } catch (_: IllegalStateException) { rejected++ }
            try { gate.capture(reservation) { } } catch (_: IllegalStateException) { rejected++ }
            assertEquals(4, rejected)
        })
        assertTrue(gate.capture(gate.reserve()!!) { assertEquals(ownerA, it.ownerId) })
    }
}
