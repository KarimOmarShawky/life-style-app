import 'package:flutter/widgets.dart';

import 'app_localizations.dart';

/// Resolves the BCP-47 tag to request from the OS speech recognizer.
///
/// Speech language is intentionally independent of the UI locale: with the
/// interface in English, an Arabic speaker still expects to dictate in
/// Arabic. An explicit user choice wins; otherwise the device language is
/// used when the app ships a catalog for it; the app locale is the last
/// resort. The recognizer itself is the OS UI — this only picks its
/// language, nothing is recorded or stored by the app.
String resolveSpeechLanguageTag({
  required Locale appLocale,
  required Locale deviceLocale,
  String speechLanguageCode = 'auto',
}) {
  if (speechLanguageCode != 'auto' &&
      AppLocalizations.isLocaleSupported(Locale(speechLanguageCode))) {
    return Locale(speechLanguageCode).toLanguageTag();
  }
  if (AppLocalizations.isLocaleSupported(deviceLocale)) {
    return deviceLocale.toLanguageTag();
  }
  return appLocale.toLanguageTag();
}
