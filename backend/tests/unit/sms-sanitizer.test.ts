/**
 * tests/unit/sms-sanitizer.test.ts
 *
 * The SMS fallback may only ever send sanitized text to the model, and model
 * output is sanitized again before it reaches the client. These tests pin the
 * redaction rules: OTPs, phone/account/reference numbers, URLs, emails, balance
 * and fee details, dates, percentages and promotional text must never survive,
 * while the transaction amount stays available for parsing.
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeSmsText,
  sanitizeSmsSender,
  sanitizeModelDescription,
  sanitizeModelMerchant,
  REDACTION_TOKENS
} from '../../src/features/ingest/sms-sanitizer.js';

describe('sanitizeSmsText', () => {
  it('redacts OTP codes but keeps the OTP label', () => {
    expect(sanitizeSmsText('Your OTP is 123456 for transaction of 500 EGP')).toBe(
      `Your OTP is ${REDACTION_TOKENS.otp} for transaction of 500 EGP`
    );
    expect(sanitizeSmsText('OTP: 4821')).toBe(`OTP: ${REDACTION_TOKENS.otp}`);
    expect(sanitizeSmsText('رمز التحقق 4821')).toBe(`رمز التحقق ${REDACTION_TOKENS.otp}`);
    expect(sanitizeSmsText('كود التحقق هو 8231')).toContain(REDACTION_TOKENS.otp);
    expect(sanitizeSmsText('Verification code X7K2P1')).toContain(REDACTION_TOKENS.otp);
  });

  it('redacts phone numbers in international, local and grouped formats', () => {
    expect(sanitizeSmsText('call +20 100 000 0000 now')).toContain(REDACTION_TOKENS.phone);
    expect(sanitizeSmsText('from 01000000000')).toContain(REDACTION_TOKENS.phone);
    expect(sanitizeSmsText('from 010-000-0000')).toContain(REDACTION_TOKENS.phone);
    expect(sanitizeSmsText('call +20 100 000 0000 now')).not.toContain('100 000 0000');
    expect(sanitizeSmsText('from 01000000000')).not.toContain('01000000000');
  });

  it('redacts labelled account and reference numbers', () => {
    expect(sanitizeSmsText('Ref 98231 completed via card 123')).toBe(
      `Ref ${REDACTION_TOKENS.reference} completed via card ${REDACTION_TOKENS.account}`
    );
    expect(sanitizeSmsText('Account 1234567890123 debited 250')).toBe(
      `Account ${REDACTION_TOKENS.account} debited 250`
    );
    expect(sanitizeSmsText('رقم المرجع 55123 تم الخصم')).toContain(REDACTION_TOKENS.reference);
  });

  it('redacts masked and full card numbers', () => {
    expect(sanitizeSmsText('card **** 1234 used')).toContain(REDACTION_TOKENS.account);
    expect(sanitizeSmsText('card 4111111111111111 used')).toContain(REDACTION_TOKENS.account);
    expect(sanitizeSmsText('card 4111111111111111 used')).not.toContain('4111111111111111');
  });

  it('redacts URLs and email addresses', () => {
    expect(sanitizeSmsText('visit https://bank.example.com/x?a=1 now')).toBe(
      `visit ${REDACTION_TOKENS.url} now`
    );
    expect(sanitizeSmsText('see www.example.com today')).toContain(REDACTION_TOKENS.url);
    expect(sanitizeSmsText('mail support@bank.example.com today')).toBe(
      `mail ${REDACTION_TOKENS.email} today`
    );
    expect(sanitizeSmsText('mail support@bank.example.com today')).not.toContain('support@bank');
  });

  it('redacts balance and fee details but keeps the transaction amount', () => {
    const sanitized = sanitizeSmsText(
      'Debited 500.00 EGP for Carrefour. Available balance 1,234.56 EGP'
    );
    expect(sanitized).toContain('Debited 500.00 EGP');
    expect(sanitized).toContain(REDACTION_TOKENS.balance);
    expect(sanitized).not.toContain('1,234.56');

    const arabic = sanitizeSmsText(
      'تم تحويل مبلغ 250 جنيه من حسابك عبر انستاباي. الرصيد 3000 جنيه'
    );
    expect(arabic).toContain('250');
    expect(arabic).toContain(REDACTION_TOKENS.balance);
    expect(arabic).not.toContain('3000');

    const fee = sanitizeSmsText('Paid 100.00 EGP with a fee of 5 EGP');
    expect(fee).toContain('100.00');
    expect(fee).toContain(REDACTION_TOKENS.fee);
    expect(fee).not.toContain('5 EGP');
  });

  it('redacts dates and percentages', () => {
    expect(sanitizeSmsText('received 1,200.00 جنيه بتاريخ 08/10/2026')).toContain(
      REDACTION_TOKENS.date
    );
    expect(sanitizeSmsText('received 1,200.00 جنيه بتاريخ 08/10/2026')).not.toContain('08/10/2026');
    expect(sanitizeSmsText('on 2026-10-08 you paid 20')).toContain(REDACTION_TOKENS.date);
    expect(sanitizeSmsText('on 8 Oct paid 20')).toContain(REDACTION_TOKENS.date);
    expect(sanitizeSmsText('cashback 2.5% on 500')).toContain(REDACTION_TOKENS.percent);
    expect(sanitizeSmsText('cashback 2.5% on 500')).not.toContain('2.5%');
  });

  it('redacts promotional sentences but keeps debit sentences with خصم', () => {
    const promo = sanitizeSmsText('Paid 100. For more information call 111. Done.');
    expect(promo).toContain('Paid 100.');
    expect(promo).toContain(REDACTION_TOKENS.promo);
    expect(promo).not.toContain('For more information');

    const arabicPromo = sanitizeSmsText('تم الخصم 100 جنيه. اشحن رصيدك الآن.');
    expect(arabicPromo).toContain('100');
    expect(arabicPromo).toContain(REDACTION_TOKENS.promo);

    // "خصم" alone is a debit keyword and must never be treated as promo.
    const debit = sanitizeSmsText('تم خصم 500 جنيه من حسابك');
    expect(debit).toContain('500');
    expect(debit).not.toContain(REDACTION_TOKENS.promo);
  });

  it('redacts bare long digit runs as account numbers and keeps small amounts', () => {
    expect(sanitizeSmsText('done 552311988 ok')).toContain(REDACTION_TOKENS.account);
    expect(sanitizeSmsText('done 552311988 ok')).not.toContain('552311988');
    expect(sanitizeSmsText('trace 552311988 done')).toContain(REDACTION_TOKENS.reference);
    expect(sanitizeSmsText('paid 125.50 EGP by InstaPay')).toBe('paid 125.50 EGP by InstaPay');
    // A large bare number is indistinguishable from a reference and must go.
    expect(sanitizeSmsText('amount 2500000 transferred')).toContain(REDACTION_TOKENS.account);
    // Decimal amounts are never treated as reference numbers.
    expect(sanitizeSmsText('paid 1234567.89 EGP')).toContain('1234567.89');
  });

  it('never leaks raw sensitive fragments from realistic bank SMS fixtures', () => {
    const fixtures: Array<{ body: string; forbidden: string[] }> = [
      {
        body: 'NBE: Debit of 750.25 EGP on card **** 4412 at AMAZON on 09/10/2026. Ref 88221133. Avl Bal 12,900.10 EGP. Call 0224111111 or visit www.nbe.com.eg',
        forbidden: ['4412', '88221133', '12,900.10', '09/10/2026', '0224111111', 'www.nbe.com.eg']
      },
      {
        body: 'Your OTP is 918273. Do not share it. For support support@vodafone.example or call 100.',
        forbidden: ['918273', 'support@vodafone.example']
      },
      {
        body: 'تم تحويل 1,200.00 جنيه إلى رقم الحساب 2233445566 بتاريخ 08/10/2026. رصيدك 5000 جنيه. خصم عمولة 3.5%',
        forbidden: ['2233445566', '08/10/2026', '5000', '3.5%']
      }
    ];
    for (const fixture of fixtures) {
      const sanitized = sanitizeSmsText(fixture.body);
      for (const secret of fixture.forbidden) {
        expect(sanitized, `leaked "${secret}" from: ${sanitized}`).not.toContain(secret);
      }
    }
  });

  it('caps the output length and collapses whitespace', () => {
    const long = `${'word '.repeat(400)} 12345`;
    const sanitized = sanitizeSmsText(long);
    expect(sanitized.length).toBeLessThanOrEqual(600);
    expect(sanitized).not.toContain('  ');
    expect(sanitizeSmsText('   spaced   out   text   ')).toBe('spaced out text');
    expect(sanitizeSmsText('')).toBe('');
    expect(sanitizeSmsText(null as unknown as string)).toBe('');
  });
});

describe('sanitizeModelDescription', () => {
  it('re-sanitizes model output with the same rules and keeps placeholders', () => {
    const cleaned = sanitizeModelDescription(
      'Transfer to [PHONE] on 08/10/2026 ref 99887766 via https://pay.example.com'
    );
    expect(cleaned).toContain(REDACTION_TOKENS.date);
    expect(cleaned).toContain(REDACTION_TOKENS.reference);
    expect(cleaned).toContain(REDACTION_TOKENS.url);
    expect(cleaned).not.toContain('99887766');
    expect(cleaned).not.toContain('08/10/2026');
    expect(cleaned).not.toContain('https://pay.example.com');

    expect(sanitizeModelDescription(null)).toBeNull();
    expect(sanitizeModelDescription(undefined)).toBeNull();
    expect(sanitizeModelDescription('   ')).toBeNull();
    expect(sanitizeModelDescription('Purchase at Carrefour')).toBe('Purchase at Carrefour');
  });
});

describe('sanitizeModelMerchant', () => {
  it('strips placeholders and keeps a plain merchant name', () => {
    expect(sanitizeModelMerchant('InstaPay')).toBe('InstaPay');
    expect(sanitizeModelMerchant('Vodafone [PHONE] Cash')).toBe('Vodafone Cash');
    expect(sanitizeModelMerchant('shop@evil.example')).toBeNull();
    expect(sanitizeModelMerchant(null)).toBeNull();
    expect(sanitizeModelMerchant('')).toBeNull();
    expect(sanitizeModelMerchant('a'.repeat(200))!.length).toBeLessThanOrEqual(60);
  });
});

describe('sanitizeSmsSender', () => {
  it('redacts phone-like senders and keeps alphanumeric sender IDs', () => {
    expect(sanitizeSmsSender('+201000000000')).toBe(REDACTION_TOKENS.phone);
    expect(sanitizeSmsSender('01000000000')).toBe(REDACTION_TOKENS.phone);
    expect(sanitizeSmsSender('NBE')).toBe('NBE');
    expect(sanitizeSmsSender('VFCASH')).toBe('VFCASH');
    expect(sanitizeSmsSender('  ')).toBe(REDACTION_TOKENS.unknown);
    expect(sanitizeSmsSender(null)).toBe(REDACTION_TOKENS.unknown);
    expect(sanitizeSmsSender('IPN1234567')).toContain(REDACTION_TOKENS.account);
    expect(sanitizeSmsSender('IPN1234567')).not.toContain('1234567');
  });
});
