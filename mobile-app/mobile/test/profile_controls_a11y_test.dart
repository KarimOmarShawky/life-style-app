import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:lifestyle_mobile/core/theme/app_theme.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/auth/presentation/profile_screen.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_models.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

class _SignedInAuth extends AuthController {
  _SignedInAuth(this._user);

  final AppUser _user;

  @override
  Future<AppUser?> build() async => _user;
}

XpEvent _win(XpType type, String id, String day, int xp) =>
    XpEvent(type: type, entityId: id, dateKey: day, xp: xp);

AppUser _user({String locale = 'en', String status = 'active'}) =>
    AppUser.fromJson({
      'id': 'user-1',
      'email': 'user@example.test',
      'displayName': 'Mona',
      'timezone': 'Africa/Cairo',
      'locale': locale,
      'defaultCurrency': 'EGP',
      'status': status,
      'productEventsEnabled': true,
    });

Future<void> _pumpProfile(
  WidgetTester tester, {
  required AppUser user,
  required XpLedger? ledger,
  String locale = 'en',
}) async {
  SharedPreferences.setMockInitialValues({'app_locale': locale});
  tester.view.devicePixelRatio = 2;
  tester.view.physicalSize = const Size(720, 1440);
  addTearDown(tester.view.reset);
  await tester.pumpWidget(ProviderScope(
    // A fresh container per call, so one locale never leaks into the next.
    key: ValueKey<String>('profile-$locale'),
    overrides: [
      authProvider.overrideWith(() => _SignedInAuth(user)),
      xpLedgerProvider.overrideWithValue(ledger),
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
      home: ProfileScreen(user: user),
    ),
  ));
  await tester.pumpAndSettle();
  expect(tester.takeException(), isNull);
}

Future<void> _scrollTo(WidgetTester tester, Finder finder) async {
  await tester.scrollUntilVisible(finder, 120,
      scrollable: find.byType(Scrollable).first);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('Profile privacy switches: Arabic at 200% text (G7)',
      (tester) async {
    SharedPreferences.setMockInitialValues({'app_locale': 'ar'});
    // A small phone: 360 x 720 logical pixels.
    tester.view.devicePixelRatio = 2;
    tester.view.physicalSize = const Size(720, 1440);
    addTearDown(tester.view.reset);
    final semantics = tester.ensureSemantics();
    const ar = AppLocalizations(Locale('ar'));
    final user = AppUser.fromJson(const {
      'id': 'user-1',
      'email': 'user@example.test',
      'displayName': 'Mona',
      'timezone': 'Africa/Cairo',
      'locale': 'ar',
      'defaultCurrency': 'EGP',
      'status': 'active',
      'productEventsEnabled': true,
    });
    await tester.pumpWidget(ProviderScope(
      overrides: [
        authProvider.overrideWith(() => _SignedInAuth(user)),
        xpLedgerProvider.overrideWithValue(XpLedger()),
      ],
      child: MaterialApp(
        theme: AppTheme.light(),
        locale: const Locale('ar'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context)
              .copyWith(textScaler: const TextScaler.linear(2)),
          child: child!,
        ),
        home: ProfileScreen(user: user),
      ),
    ));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    for (final title in [ar.usageStatsTitle, ar.aiTaskParsingTitle]) {
      await tester.scrollUntilVisible(find.text(title), 120,
          scrollable: find.byType(Scrollable).first);
      // ensureVisible jumps without a frame; lay out before checking.
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      final tile = find.ancestor(
        of: find.text(title),
        matching: find.byType(SwitchListTile),
      );
      expect(tile, findsOneWidget);
      expect(Directionality.of(tester.element(tile)), TextDirection.rtl);
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    }
    semantics.dispose();
  });

  testWidgets('Rank card and badges come from the device ledger (P1-F15)',
      (tester) async {
    final semantics = tester.ensureSemantics();
    const en = AppLocalizations(Locale('en'));
    final ledger = XpLedger([
      _win(XpType.task, 't1', '2026-11-01', 25),
      _win(XpType.task, 't2', '2026-11-02', 25),
      _win(XpType.focus, 'f1', '2026-11-03', 40),
    ]);
    await _pumpProfile(tester, user: _user(), ledger: ledger);

    expect(find.text(en.levelXpBadge(1, 90)), findsOneWidget);
    expect(find.text(en.xpRemainingText(110, 2)), findsOneWidget);
    expect(find.text(en.xpDeviceNote), findsOneWidget);
    expect(find.text('Level 2 • 140 XP'), findsNothing);
    final bar = tester.widget<LinearProgressIndicator>(
      find.byType(LinearProgressIndicator),
    );
    expect(bar.value, closeTo(0.45, 1e-9));

    await _scrollTo(tester, find.text(en.badgeDiscipline));
    final earnedTask =
        '${en.badgeStrongStart}. ${en.badgeFirstTask}. ${en.badgeEarned}';
    final earnedFocus =
        '${en.badgeFocusHero}. ${en.badgePomodoro}. ${en.badgeEarned}';
    final lockedStreak =
        '${en.badgeDiscipline}. ${en.badgeStreak7}. ${en.badgeLocked}';
    expect(find.bySemanticsLabel(earnedTask), findsOneWidget);
    expect(find.bySemanticsLabel(earnedFocus), findsOneWidget);
    expect(find.bySemanticsLabel(lockedStreak), findsOneWidget);
    await expectLater(tester, meetsGuideline(textContrastGuideline));

    // G6: the signed-in devices entry is offered to active accounts.
    await _scrollTo(tester, find.text(en.signedInDevicesTitle));
    expect(find.text(en.signedInDevicesSubtitle), findsOneWidget);
    semantics.dispose();
  });

  testWidgets('No rank card or badges before the ledger loads (P1-F15)',
      (tester) async {
    const en = AppLocalizations(Locale('en'));
    await _pumpProfile(tester, user: _user(), ledger: null);
    expect(find.text(en.accountRank), findsNothing);
    expect(find.text(en.achievementBadges), findsNothing);
    expect(find.byType(LinearProgressIndicator), findsNothing);
  });

  testWidgets('Account texts follow the app language (A3)', (tester) async {
    for (final code in ['de', 'tr', 'ar']) {
      final l10n = AppLocalizations(Locale(code));
      await _pumpProfile(
        tester,
        user: _user(locale: code, status: 'pending_deletion'),
        ledger: XpLedger(),
        locale: code,
      );
      expect(find.text(l10n.deletionPendingBanner), findsOneWidget);
      expect(find.text(l10n.deletionRestoreAction), findsOneWidget);
      await _scrollTo(tester, find.text(l10n.aiAssistantSubtitle));
      expect(find.text(l10n.aiAssistant), findsOneWidget);
      await _scrollTo(tester, find.text(l10n.accountStatusPendingDeletion));
      expect(find.text(l10n.signedInDevicesTitle), findsNothing);
      for (final english in [
        'AI Assistant',
        'Cancel Deletion & Restore Account',
        'pending_deletion (14-day grace)',
      ]) {
        expect(find.text(english), findsNothing);
      }
    }
  });
}
