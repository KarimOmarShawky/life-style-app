package com.example.lifestyle_mobile

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WalletSenderScopeTest {
    @Test fun acceptsExactKnownSenderIdsAndExplicitlyApprovedSenders() {
        assertTrue(WalletSenderScope.isEligible("CIB", false))
        assertTrue(WalletSenderScope.isEligible("vf-cash", false))
        assertTrue(WalletSenderScope.isEligible("+201001234567", true))
    }

    @Test fun rejectsUnknownSendersAndSubstringImpersonation() {
        assertFalse(WalletSenderScope.isEligible("Friend", false))
        assertFalse(WalletSenderScope.isEligible("MyCIBStore", false))
        assertFalse(WalletSenderScope.isEligible("CIB-SUPPORT-FAKE", false))
        assertFalse(WalletSenderScope.isEligible("", true))
    }

    @Test fun senderLabelsAreOnlyHintsNotOwnershipProof() {
        // A user-approved sender may be a phone number or an alphanumeric ID.
        // Neither this decision nor an exact known name authenticates an SMS.
        assertTrue(WalletSenderScope.isEligible("NBE", false))
        assertFalse(WalletSenderScope.isEligible("unknown", false))
    }
}
