import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:lifestyle_mobile/core/links/external_link_opener.dart';
import 'package:lifestyle_mobile/core/theme/app_theme.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_settings_client.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/auth/presentation/profile_screen.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_models.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

// Hybrid AI AI-2c: the AI consent kept on the server can be withdrawn from
// Profile; the assistant then asks again before it sends anything.

const _en = AppLocalizations(Locale('en'));
const _ar = AppLocalizations(Locale('ar'));
Finder get _tile => find.byKey(const ValueKey('ai-consent-tile'));

class _SignedInAuth extends AuthController {
  _SignedInAuth(this._user);

  final AppUser _user;

  @override
  Future<AppUser?> build() async => _user;
}

class _WithdrawingSettings implements AiSettingsClient {
  _WithdrawingSettings([this.failure]);

  final Object? failure;
  int withdrawals = 0;

  @override
  Future<AiSettingsSnapshot> fetch() async {
    throw UnimplementedError();
  }

  @override
  Future<AiSettingsSnapshot> grantConsent() async {
    throw UnimplementedError();
  }

  @override
  Future<AiSettingsSnapshot> setMemoryEnabled(bool enabled) async {
    throw UnimplementedError();
  }

  @override
  Future<AiSettingsSnapshot> withdrawConsent() async {
    withdrawals++;
    final error = failure;
    if (error != null) throw error;
    return const AiSettingsSnapshot(
      consentVersion: null,
      currentConsentVersion: 1,
      available: true,
    );
  }
}

Future<void> _pumpProfile(
  WidgetTester tester,
  AiSettingsClient settings, {
  String locale = 'en',
  double textScale = 1,
}) async {
  SharedPreferences.setMockInitialValues({'app_locale': locale});
  // A small phone: 360 x 720 logical pixels.
  tester.view.devicePixelRatio = 2;
  tester.view.physicalSize = const Size(720, 1440);
  addTearDown(tester.view.reset);
  final user = AppUser.fromJson({
    'id': 'user-1',
    'email': 'user@example.test',
    'displayName': 'Mona',
    'timezone': 'Africa/Cairo',
    'locale': locale,
    'defaultCurrency': 'EGP',
    'status': 'active',
    'productEventsEnabled': true,
  });
  await tester.pumpWidget(ProviderScope(
    key: UniqueKey(),
    overrides: [
      authProvider.overrideWith(() => _SignedInAuth(user)),
      xpLedgerProvider.overrideWithValue(XpLedger()),
      privacyPolicyUriProvider.overrideWithValue(null),
      aiSettingsClientProvider.overrideWithValue(settings),
    ],
    child: MaterialApp(
      theme: AppTheme.light(),
      locale: Locale(locale),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context)
            .copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
      home: ProfileScreen(user: user),
    ),
  ));
  await tester.pumpAndSettle();
  expect(tester.takeException(), isNull);
  await tester.scrollUntilVisible(_tile, 300,
      scrollable: find.byType(Scrollable).first, maxScrolls: 100);
  // ensureVisible jumps without a frame; lay out before checking.
  await tester.pumpAndSettle();
  expect(tester.takeException(), isNull);
}

Future<void> _withdraw(WidgetTester tester, AppLocalizations l10n) async {
  await tester.tap(_tile);
  await tester.pumpAndSettle();
  expect(find.text(l10n.aiConsentWithdrawTitle), findsOneWidget);
  await tester.tap(find.text(l10n.aiConsentWithdrawAction));
  await tester.pumpAndSettle();
}

int _revision(WidgetTester tester) =>
    ProviderScope.containerOf(tester.element(find.byType(ProfileScreen)))
        .read(aiConsentRevisionProvider);

/// WCAG contrast of a text against the screen background.
double _contrast(WidgetTester tester, String text) {
  final rich = tester.widget<RichText>(
    find.descendant(of: find.text(text), matching: find.byType(RichText)),
  );
  final background =
      Theme.of(tester.element(find.text(text))).scaffoldBackgroundColor;
  final foreground = Color.alphaBlend(rich.text.style!.color!, background);
  final a = foreground.computeLuminance();
  final b = background.computeLuminance();
  return (math.max(a, b) + 0.05) / (math.min(a, b) + 0.05);
}

void main() {
  testWidgets('withdrawing the AI consent tells the assistant', (tester) async {
    final settings = _WithdrawingSettings();
    await _pumpProfile(tester, settings);
    expect(find.text(_en.aiConsentTileSubtitle), findsOneWidget);

    await _withdraw(tester, _en);

    expect(settings.withdrawals, 1);
    expect(find.text(_en.aiConsentWithdrawn), findsOneWidget);
    expect(_revision(tester), 1);
  });

  testWidgets('cancelling keeps the consent', (tester) async {
    final settings = _WithdrawingSettings();
    await _pumpProfile(tester, settings);

    await tester.tap(_tile);
    await tester.pumpAndSettle();
    await tester.tap(find.text(_en.cancel));
    await tester.pumpAndSettle();

    expect(settings.withdrawals, 0);
    expect(_revision(tester), 0);
  });

  testWidgets('with nothing stored on the server yet, it still counts',
      (tester) async {
    final settings = _WithdrawingSettings(
      const ApiException(
        statusCode: 503,
        code: 'AI_SETTINGS_UNAVAILABLE',
        message: 'AI settings are not available yet',
      ),
    );
    await _pumpProfile(tester, settings);

    await _withdraw(tester, _en);

    expect(find.text(_en.aiConsentWithdrawn), findsOneWidget);
    expect(_revision(tester), 1);
  });

  testWidgets('a failed withdrawal says so and changes nothing',
      (tester) async {
    final settings = _WithdrawingSettings(
      const ApiException(statusCode: 0, code: 'NETWORK', message: 'offline'),
    );
    await _pumpProfile(tester, settings);

    await _withdraw(tester, _en);

    expect(find.text(_en.settingSaveFailed), findsOneWidget);
    expect(find.text(_en.aiConsentWithdrawn), findsNothing);
    expect(_revision(tester), 0);
  });

  testWidgets('G7: AI consent entry in Arabic at 200% text', (tester) async {
    final semantics = tester.ensureSemantics();
    final settings = _WithdrawingSettings();
    await _pumpProfile(tester, settings, locale: 'ar', textScale: 2);

    expect(Directionality.of(tester.element(_tile)), TextDirection.rtl);
    expect(tester.getSize(_tile).height, greaterThanOrEqualTo(48));
    expect(find.text(_ar.aiConsentTileSubtitle), findsOneWidget);
    expect(
        _contrast(tester, _ar.aiConsentTileTitle), greaterThanOrEqualTo(4.5));
    expect(
      _contrast(tester, _ar.aiConsentTileSubtitle),
      greaterThanOrEqualTo(4.5),
    );
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));

    await _withdraw(tester, _ar);
    expect(settings.withdrawals, 1);
    expect(tester.takeException(), isNull);
    semantics.dispose();
  });
}
