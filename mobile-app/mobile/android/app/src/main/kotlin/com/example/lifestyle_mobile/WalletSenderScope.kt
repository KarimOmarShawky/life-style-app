package com.example.lifestyle_mobile

import java.util.Locale

/**
 * Narrows SMS capture to known wallet/bank sender labels or labels explicitly
 * approved by the user. Sender IDs can be spoofed: this is a scope heuristic,
 * not evidence of account ownership or of the authenticity of a message.
 */
internal object WalletSenderScope {
    private val knownSenderIds = setOf(
        "INSTAPAY", "IPN", "VODAFONE", "VFCASH", "ORANGE", "ETISALAT",
        "WEPAY", "FAWRY", "CIB", "NBE", "BANQUEMISR", "QNB", "ALEXBANK",
        "ADIB", "HSBC", "MASHREQ", "AHLY", "AHLI", "EMIRATESNBD", "ENBD",
        "FAISAL", "AAIB", "BDC", "ALBARAKA", "SUEZCANAL"
    )

    fun normalize(sender: String): String {
        val trimmed = sender.trim()
        return if (trimmed.any { it in 'A'..'Z' || it in 'a'..'z' }) {
            trimmed.uppercase(Locale.ROOT).filter { it in 'A'..'Z' || it in '0'..'9' }
        } else {
            trimmed.filter { it in '0'..'9' }
        }
    }

    fun isEligible(sender: String, userApproved: Boolean): Boolean {
        val normalized = normalize(sender)
        return normalized.isNotEmpty() && (userApproved || normalized in knownSenderIds)
    }
}
