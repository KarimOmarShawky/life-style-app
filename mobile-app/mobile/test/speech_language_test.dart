import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';
import 'package:lifestyle_mobile/l10n/speech_language.dart';

void main() {
  group('resolveSpeechLanguageTag', () {
    test('an explicit speech choice wins over UI and device', () {
      expect(
        resolveSpeechLanguageTag(
          appLocale: const Locale('en'),
          deviceLocale: const Locale('en'),
          speechLanguageCode: 'ar',
        ),
        'ar',
      );
    });

    test('device language wins over an English UI by default', () {
      expect(
        resolveSpeechLanguageTag(
          appLocale: const Locale('en'),
          deviceLocale: const Locale('ar'),
        ),
        'ar',
      );
    });

    test('an unsupported device language falls back to the app locale', () {
      expect(
        resolveSpeechLanguageTag(
          appLocale: const Locale('en'),
          deviceLocale: const Locale('ja'),
        ),
        'en',
      );
    });

    test('an unsupported explicit choice falls back to the device', () {
      expect(
        resolveSpeechLanguageTag(
          appLocale: const Locale('en'),
          deviceLocale: const Locale('ar'),
          speechLanguageCode: 'ja',
        ),
        'ar',
      );
    });
  });

  group('encouragement catalog entries', () {
    test('Arabic encouragement strings render with placeholders filled', () {
      const ar = AppLocalizations(Locale('ar'));
      expect(ar.voiceRetry, isNotEmpty);
      expect(ar.taskAddedEnc('مهمة').contains('مهمة'), isTrue);
      expect(ar.weeklyWinsLine(3, 25).contains('3'), isTrue);
      expect(ar.encourageAt(1), isNotEmpty);
    });

    test('English fallbacks render too', () {
      const en = AppLocalizations(Locale('en'));
      expect(en.focusCompleteEncouragement, isNotEmpty);
      expect(en.weeklyWinsEmpty, isNotEmpty);
    });
  });
}
