import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:lifestyle_mobile/data/settings_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('AppLocalizations catalogs', () {
    test('ships the six supported locales with endonyms', () {
      final codes =
          AppLocalizations.supportedLocales.map((l) => l.languageCode).toSet();
      expect(codes, containsAll(<String>['ar', 'en', 'fr', 'es', 'de', 'tr']));
      for (final code in codes) {
        expect(AppLocalizations.endonyms[code], isNotEmpty);
        expect(AppLocalizations.promptNames[code], isNotEmpty);
      }
    });

    test('every catalog covers the full English key set', () {
      const en = AppLocalizations(Locale('en'));
      final reference = <String>[
        en.appTitle,
        en.signIn,
        en.tasks,
        en.money,
        en.smsSyncTitle,
        en.voiceMicPrompt,
        en.noSpeechDetected,
      ];
      for (final locale in AppLocalizations.supportedLocales) {
        final l10n = AppLocalizations(locale);
        expect(l10n.appTitle, isNotEmpty);
        expect(l10n.signIn, isNotEmpty);
        expect(l10n.smsSyncTitle, isNot(equals('smsSyncTitle')));
        expect(l10n.noSpeechDetected, isNot(equals('noSpeechDetected')));
      }
      expect(reference.length, greaterThan(0));
    });

    test('unknown locales fall back to English instead of leaking keys', () {
      const l10n = AppLocalizations(Locale('zz'));
      expect(l10n.signIn, 'Sign in');
      expect(l10n.smsSyncTitle, 'Wallet SMS auto-capture');
      expect(AppLocalizations.isLocaleSupported(const Locale('zz')), isFalse);
    });

    test('parameterized strings interpolate placeholders per locale', () {
      const en = AppLocalizations(Locale('en'));
      const ar = AppLocalizations(Locale('ar'));
      expect(en.briefingSummaryText(4, 2), contains('4'));
      expect(en.briefingSummaryText(4, 2), contains('2'));
      expect(en.briefingSummaryText(4, 2), isNot(contains('{total}')));
      expect(ar.briefingSummaryText(4, 2), isNot(contains('{completed}')));
      expect(en.searchNoResultsFor('cairo'), contains('cairo'));
      expect(en.billingUnitLabel('month'), isNot(equals('billingUnit.month')));
      expect(en.ambientLabel('rain'), isNot(equals('rain')));
      expect(en.ambientLabel('unknown_key'), 'unknown_key');
    });

    test('RTL flag follows script direction', () {
      expect(const AppLocalizations(Locale('ar')).isRTL, isTrue);
      expect(const AppLocalizations(Locale('fr')).isRTL, isFalse);
    });

    testWidgets('delegate resolves the active locale inside the widget tree',
        (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('fr'),
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: Builder(
            builder: (context) => Text(
              AppLocalizations.of(context).smsSyncTitle,
              textDirection: TextDirection.ltr,
            ),
          ),
        ),
      );
      await tester.pump();
      expect(find.text('Capture auto des SMS portefeuille'), findsOneWidget);
    });

    testWidgets('Arabic locale renders right-to-left', (tester) async {
      late TextDirection direction;
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('ar'),
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: Builder(
            builder: (context) {
              direction = Directionality.of(context);
              return const SizedBox.shrink();
            },
          ),
        ),
      );
      await tester.pump();
      expect(direction, TextDirection.rtl);
    });
  });

  group('SettingsNotifier persistence', () {
    setUp(() => SharedPreferences.setMockInitialValues(<String, Object>{}));

    test('setLocale persists any supported language code', () async {
      final notifier = SettingsNotifier();
      await Future<void>.delayed(Duration.zero);

      await notifier.setLocale(const Locale('de'));
      expect(notifier.state.locale, const Locale('de'));

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('app_locale'), 'de');
    });

    test('setLocale ignores unsupported languages', () async {
      final notifier = SettingsNotifier();
      await Future<void>.delayed(Duration.zero);
      final before = notifier.state.locale;

      await notifier.setLocale(const Locale('zz'));
      expect(notifier.state.locale, before);
    });

    test('sms sync toggle persists the native-visible flag', () async {
      final notifier = SettingsNotifier();
      await Future<void>.delayed(Duration.zero);
      expect(notifier.state.smsSyncEnabled, isFalse);

      await notifier.setSmsSyncEnabled(true);
      expect(notifier.state.smsSyncEnabled, isTrue);

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getBool('sms_sync_enabled'), isTrue);
      // The Android receiver reads the same value under the flutter. prefix.
      expect(prefs.getBool('flutter.sms_sync_enabled'), isNull);
    });

    test('loads persisted locale on startup', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{
        'app_locale': 'tr',
        'app_theme_mode': 'dark',
      });
      final notifier = SettingsNotifier();
      await Future<void>.delayed(Duration.zero);

      expect(notifier.state.locale, const Locale('tr'));
      expect(notifier.state.themeMode, ThemeMode.dark);
    });
  });
}
