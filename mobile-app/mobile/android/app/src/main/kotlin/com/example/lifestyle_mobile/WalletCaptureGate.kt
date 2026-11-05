package com.example.lifestyle_mobile

/**
 * Unwired, process-local building block for the future wallet capture boundary.
 * A fresh instance is inactive, including after process restart. It does not
 * authenticate a credential or provide cross-process coordination. Callers
 * must prove activation against the actual live authentication session and
 * route every relevant native and Flutter operation through one authority.
 *
 * Reserve synchronously at the chosen SMS arrival boundary, before deferring
 * work. A reservation cannot be transferred to another session. The capture
 * callback must persist the owner-bound record synchronously before returning,
 * without network calls, async work, re-entry, or retaining the credential.
 * The gate only orders that callback with transitions; it cannot make storage
 * durable or roll back a partial write. Rejected reservations require a safe
 * hold strategy; this class does not preserve or acknowledge the source SMS.
 */
internal class WalletCaptureGate {
    internal class Transition internal constructor()
    internal interface Reservation
    private class GateReservation(val sessionKey: Any) : Reservation {
        var used = false
    }
    private class Session(val credential: WalletBoundCredential, val key: Any = Any())

    private val lock = Any()
    private var pending: Transition? = null
    private var active: Session? = null
    private var capturing = false

    /**
     * Deactivate and invalidate all outstanding tickets. The transition
     * linearizes when the lock is acquired, not when the method is invoked.
     * The caller must await completion before claiming sign-out/switch.
     */
    fun invalidate() = synchronized(lock) {
        check(!capturing) { "Capture callback cannot transition the gate" }
        active = null
        pending = null
    }

    /** Start a new activation attempt, deactivating any previous session. */
    fun beginActivation(): Transition = synchronized(lock) {
        check(!capturing) { "Capture callback cannot transition the gate" }
        active = null
        Transition().also { pending = it }
    }

    /** The credential must already be validated for this exact auth transition. */
    fun activate(ticket: Transition, credential: WalletBoundCredential): Boolean = synchronized(lock) {
        check(!capturing) { "Capture callback cannot activate the gate" }
        if (pending !== ticket) return@synchronized false
        pending = null
        active = Session(credential)
        true
    }

    /** Reserve the current session without exposing its owner or credential. */
    fun reserve(): Reservation? = synchronized(lock) {
        check(!capturing) { "Capture callback cannot re-enter the gate" }
        active?.let { GateReservation(it.key) }
    }

    /** False means stale/reused and the callback was not invoked. Exceptions propagate. */
    fun capture(reservation: Reservation, write: (WalletBoundCredential) -> Unit): Boolean = synchronized(lock) {
        check(!capturing) { "Capture callback cannot re-enter the gate" }
        val session = active ?: return@synchronized false
        val reserved = reservation as? GateReservation ?: return@synchronized false
        if (reserved.sessionKey !== session.key || reserved.used) return@synchronized false
        reserved.used = true
        capturing = true
        try {
            write(session.credential)
            true
        } finally {
            capturing = false
        }
    }
}
