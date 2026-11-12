import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:lifestyle_mobile/config/app_config.dart';
import 'package:lifestyle_mobile/core/links/external_link_opener.dart';
import 'package:lifestyle_mobile/core/theme/app_theme.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/auth/presentation/profile_screen.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_models.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

// Google Play requires the privacy policy inside the app. The Profile opens
// the published page through an Android view intent; release builds get the
// URL from CI and the repository holds none.
const _policy = 'https://docs.google.com/document/d/e/test-policy/pub';
const _channel = MethodChannel('com.example.lifestyle_mobile/native_voice');

class _SignedInAuth extends AuthController {
  _SignedInAuth(this._user);

  final AppUser _user;

  @override
  Future<AppUser?> build() async => _user;
}

class _FakeOpener implements ExternalLinkOpener {
  _FakeOpener(this.result);

  final bool result;
  final opened = <Uri>[];

  @override
  Future<bool> open(Uri link) async {
    opened.add(link);
    return result;
  }
}

Future<_FakeOpener> _pumpProfile(
  WidgetTester tester, {
  required Uri? policy,
  bool opens = true,
  String locale = 'en',
  double textScale = 1,
}) async {
  SharedPreferences.setMockInitialValues({'app_locale': locale});
  // A small phone: 360 x 720 logical pixels.
  tester.view.devicePixelRatio = 2;
  tester.view.physicalSize = const Size(720, 1440);
  addTearDown(tester.view.reset);
  final opener = _FakeOpener(opens);
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
      privacyPolicyUriProvider.overrideWithValue(policy),
      externalLinkOpenerProvider.overrideWithValue(opener),
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
  return opener;
}

Future<void> _scrollTo(WidgetTester tester, Finder finder) async {
  // The entry sits near the end of Profile: at 200% text the list is longer
  // than 50 steps of 120 px, so take larger steps (still under one screen).
  await tester.scrollUntilVisible(finder, 300,
      scrollable: find.byType(Scrollable).first, maxScrolls: 100);
  // ensureVisible jumps without a frame; lay out before checking.
  await tester.pumpAndSettle();
  expect(tester.takeException(), isNull);
}

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
  group('httpsLinkOrNull', () {
    test('accepts only a plain absolute https link', () {
      expect(
        AppConfig.httpsLinkOrNull(' $_policy '),
        Uri.parse(_policy),
      );
      expect(
        AppConfig.httpsLinkOrNull('HTTPS://example.com/privacy')?.scheme,
        'https',
      );
      for (final rejected in [
        '',
        '   ',
        'http://example.com/privacy',
        'javascript:alert(1)',
        'intent://scan/#Intent;scheme=zxing;end',
        'file:///data/user/0/x',
        '//example.com/privacy',
        'https://',
        'https://someone@example.com/privacy',
        'https://example.com/pri vacy',
        'https://example.com/\nprivacy',
        'https://example.com/${'a' * 2048}',
      ]) {
        expect(AppConfig.httpsLinkOrNull(rejected), isNull, reason: rejected);
      }
    });

    test('a build without the define has no policy link', () {
      expect(AppConfig.privacyPolicyUrl, isEmpty);
      expect(AppConfig.privacyPolicyUri, isNull);
    });
  });

  group('ExternalLinkOpener', () {
    final calls = <MethodCall>[];
    PlatformException? failure;

    setUp(() {
      calls.clear();
      failure = null;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(_channel, (call) async {
        calls.add(call);
        if (failure != null) throw failure!;
        return null;
      });
    });

    tearDown(() {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(_channel, null);
    });

    test('asks Android to open the https page', () async {
      expect(await const ExternalLinkOpener().open(Uri.parse(_policy)), isTrue);
      expect(calls.single.method, 'openHttpsUrl');
      expect(calls.single.arguments, {'url': _policy});
    });

    test('reports false when no app can open it', () async {
      failure = PlatformException(code: 'LINK_UNAVAILABLE');
      expect(
        await const ExternalLinkOpener().open(Uri.parse(_policy)),
        isFalse,
      );
      expect(calls, hasLength(1));
    });

    test('never sends another scheme to Android', () async {
      for (final link in ['http://example.com/p', 'javascript:alert(1)']) {
        expect(await const ExternalLinkOpener().open(Uri.parse(link)), isFalse);
      }
      expect(calls, isEmpty);
    });

    test('reports false without the Android side', () async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(_channel, null);
      expect(
        await const ExternalLinkOpener().open(Uri.parse(_policy)),
        isFalse,
      );
    });
  });

  testWidgets('Profile opens the privacy policy in the browser',
      (tester) async {
    const en = AppLocalizations(Locale('en'));
    final opener = await _pumpProfile(tester, policy: Uri.parse(_policy));
    await _scrollTo(tester, find.text(en.privacyPolicyTitle));
    expect(find.text(en.privacyPolicySubtitle), findsOneWidget);

    await tester.tap(find.text(en.privacyPolicyTitle));
    await tester.pumpAndSettle();
    expect(opener.opened, [Uri.parse(_policy)]);
    expect(find.text(en.privacyPolicyOpenFailed), findsNothing);
  });

  testWidgets('A failed open is explained', (tester) async {
    const en = AppLocalizations(Locale('en'));
    final opener = await _pumpProfile(
      tester,
      policy: Uri.parse(_policy),
      opens: false,
    );
    await _scrollTo(tester, find.text(en.privacyPolicyTitle));
    await tester.tap(find.text(en.privacyPolicyTitle));
    await tester.pumpAndSettle();
    expect(opener.opened, hasLength(1));
    expect(find.text(en.privacyPolicyOpenFailed), findsOneWidget);
  });

  testWidgets('Without a configured link the entry is hidden', (tester) async {
    const en = AppLocalizations(Locale('en'));
    await _pumpProfile(tester, policy: null);
    // The entry sits between the account export and account deletion.
    await _scrollTo(tester, find.text(en.deleteAccountAction));
    expect(find.text(en.accountExportTitle), findsOneWidget);
    expect(find.text(en.privacyPolicyTitle), findsNothing);
  });

  testWidgets('Privacy policy entry: Arabic at 200% text (G7)', (tester) async {
    final semantics = tester.ensureSemantics();
    const ar = AppLocalizations(Locale('ar'));
    final opener = await _pumpProfile(
      tester,
      policy: Uri.parse(_policy),
      locale: 'ar',
      textScale: 2,
    );
    await _scrollTo(tester, find.text(ar.privacyPolicyTitle));
    final tile = find.ancestor(
      of: find.text(ar.privacyPolicyTitle),
      matching: find.byType(ListTile),
    );
    expect(tile, findsOneWidget);
    expect(Directionality.of(tester.element(tile)), TextDirection.rtl);
    expect(tester.getSize(tile).height, greaterThanOrEqualTo(48));
    expect(find.text(ar.privacyPolicySubtitle), findsOneWidget);
    expect(_contrast(tester, ar.privacyPolicyTitle), greaterThanOrEqualTo(4.5));
    expect(
      _contrast(tester, ar.privacyPolicySubtitle),
      greaterThanOrEqualTo(4.5),
    );
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));

    await tester.tap(tile);
    await tester.pumpAndSettle();
    expect(opener.opened, [Uri.parse(_policy)]);
    semantics.dispose();
  });
}
