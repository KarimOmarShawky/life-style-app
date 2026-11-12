/**
 * src/features/ai/application/ai-language-resolver.ts
 *
 * Picks the language named in the system instruction for requests whose own
 * language the model cannot detect (an emoji, a number, a one-word reply).
 * The model still answers in the language of the latest message.
 *
 * Order: an unambiguous script in the latest message (Arabic; Latin script
 * is shared by five app languages), then the client's hint, then the
 * account locale, then English. AI0-F9: the default was always Arabic.
 */

const LOCALE_LANGUAGES: Readonly<Record<string, string>> = {
  ar: 'Arabic',
  en: 'English',
  de: 'German',
  es: 'Spanish',
  fr: 'French',
  tr: 'Turkish'
};

const LETTER = /\p{L}/u;
const ARABIC_LETTER = /\p{Script=Arabic}/u;

export interface ReplyLanguageHints {
  latestMessage: string;
  /** Sanitized display name sent by the client, e.g. "Arabic". */
  clientLanguage?: string | null;
  /** BCP-47 locale of the account, e.g. "ar" or "en-GB". */
  userLocale?: string | null;
}

/** True when at least two letters are present and four in five are Arabic script. */
export function isClearlyArabicScript(text: string): boolean {
  let letters = 0;
  let arabic = 0;
  for (const char of text) {
    if (!LETTER.test(char)) continue;
    letters += 1;
    if (ARABIC_LETTER.test(char)) arabic += 1;
  }
  return arabic >= 2 && arabic * 5 >= letters * 4;
}

/** Two-letter base of a BCP-47 locale ("en-GB" -> "en"), lower case. */
export function localeBase(locale: string): string {
  return locale.trim().slice(0, 2).toLowerCase();
}

/** Display name of an app locale for the prompt; English for anything else. */
export function languageForLocale(locale: string | null | undefined): string {
  return LOCALE_LANGUAGES[localeBase(locale ?? '')] ?? 'English';
}

export function resolveReplyLanguage(hints: ReplyLanguageHints): string {
  if (isClearlyArabicScript(hints.latestMessage)) return 'Arabic';
  const client = hints.clientLanguage?.trim();
  if (client) return client;
  return languageForLocale(hints.userLocale);
}
