import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:lifestyle_mobile/core/theme/app_theme.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/auth/presentation/profile_screen.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

class _SignedInAuth extends AuthController {
  _SignedInAuth(this._user);

  final AppUser _user;

  @override
  Future<AppUser?> build() async => _user;
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
      overrides: [authProvider.overrideWith(() => _SignedInAuth(user))],
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
}
