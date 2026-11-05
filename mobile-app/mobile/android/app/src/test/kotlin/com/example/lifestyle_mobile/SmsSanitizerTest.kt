package com.example.lifestyle_mobile

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SmsSanitizerTest {
    @Test fun redactsArabicAndPersianDigitsAndDirectionalMarksBeforeQueueing() {
        val result = SmsSanitizer.sanitize("رمز التحقق ١٢٣\u200f٤٥٦. الحساب ۱۲۳۴۵۶۷۸۹. الرصيد ١٬٢٣٤٫٥٦ جنيه. تم خصم ٢٥٠٫٥٠ جنيه")
        assertTrue(result.contains("رمز التحقق [OTP]"))
        assertTrue(result.contains("الحساب [ACCOUNT]"))
        assertTrue(result.contains("الرصيد [BALANCE]"))
        assertTrue(result.contains("250.50 جنيه"))
        assertFalse(result.contains("123456"))
        assertFalse(result.contains("123456789"))
        assertFalse(result.contains("1,234.56"))
        assertFalse(result.contains('\u200f'))
    }

    @Test fun balanceAndFeePatternsDoNotThrowAndPreserveTransactionAmount() {
        val result = SmsSanitizer.sanitize("Paid 100 EGP. Balance 1,234.56 EGP. fee 5 EGP.")
        assertTrue(result.contains("100 EGP"))
        assertTrue(result.contains("[BALANCE]"))
        assertTrue(result.contains("[FEE]"))
        assertFalse(result.contains("1,234.56"))
    }

    @Test fun redactsLocalizedSendersAndKeepsNamedSenders() {
        assertTrue(SmsSanitizer.sanitizeSender("+٢٠١٠٠٠\u200f٠٠٠٠٠٠") == "[PHONE]")
        assertFalse(SmsSanitizer.sanitizeSender("IPN۱۲۳۴۵۶۷").contains("1234567"))
        assertTrue(SmsSanitizer.sanitizeSender("NBE") == "NBE")
    }

    @Test fun removesAllMaskedDigitsFromBodyAndSender() {
        assertFalse(SmsSanitizer.sanitize("used **** 1234 today").contains("34"))
        assertFalse(SmsSanitizer.sanitizeSender("Bank **** 1234").contains("34"))
    }

    @Test fun removesGroupedCardDigits() {
        val grouped = SmsSanitizer.sanitize("Paid 200 EGP using 4111 1111 1111 1111.")
        assertFalse(grouped.contains("4111"))
        assertFalse(grouped.contains("1111"))
        assertTrue(grouped.contains("200 EGP"))
    }
}
