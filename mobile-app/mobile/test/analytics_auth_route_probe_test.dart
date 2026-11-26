import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/core_providers.dart';
import 'package:lifestyle_mobile/app.dart';
import 'package:lifestyle_mobile/features/more/presentation/more_screen.dart';
import 'package:lifestyle_mobile/features/analytics/presentation/analytics_screen.dart';
import 'package:lifestyle_mobile/features/onboarding/onboarding_screen.dart';
import 'package:lifestyle_mobile/features/focus_shield/home_widget_sync.dart';
import 'package:lifestyle_mobile/features/digital_detox/detox_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_reports_client.dart';
import 'package:lifestyle_mobile/features/ai/presentation/ai_report_sheet.dart';
import 'package:lifestyle_mobile/features/auth/data/auth_repository.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

// Characterization only: actual LifeStyleApp and MoreScreen route, with
// fake auth, mocked HTTP and a programmatically forced transition. The test
// injects MoreScreen; it does not prove real-user account-switch reachability.
class _Tokens implements TokenStore {
  SessionTokens? value = _token('A');
  @override
  Future<SessionTokens?> read() async => value;
  @override
  Future<void> write(SessionTokens tokens) async => value = tokens;
  @override
  Future<void> clear() async => value = null;
}

SessionTokens _token(String account) => SessionTokens(
      accessToken: 'synthetic-access-$account',
      refreshToken: 'synthetic-refresh-$account',
      accessTokenExpiresAt: DateTime.utc(2099),
      refreshTokenExpiresAt: DateTime.utc(2099),
    );

AppUser _user(String id) => AppUser(
      id: id,
      email: '$id@example.test',
      displayName: id,
      timezone: 'UTC',
      locale: 'en',
      defaultCurrency: 'USD',
      status: 'active',
      onboardingPending: true,
    );

class _Repository extends AuthRepository {
  _Repository(ApiClient api, this.store) : super(api: api, tokens: store);
  final _Tokens store;
  @override
  Future<AppUser?> restoreSession() async => _user('A');
  @override
  Future<AppUser> login({required String email, required String password}) async {
    await store.write(_token('B'));
    return _user('B');
  }
}

void main() {
  testWidgets('characterizes a More analytics route across controller transition', (tester) async {
    SharedPreferences.setMockInitialValues({'app_locale': 'en'});
    final store = _Tokens();
    final transport = MockClient((request) async => http.Response(
          jsonEncode({'success': false, 'error': {'code': 'UNAVAILABLE', 'message': 'synthetic'}}),
          503,
          headers: {'content-type': 'application/json'},
        ));
    final api = ApiClient(
      baseUri: Uri.parse('https://api.example.test/api/v1/'),
      tokenStore: store,
      httpClient: transport,
    );
    final container = ProviderContainer(overrides: [
      authRepositoryProvider.overrideWithValue(_Repository(api, store)),
      apiClientProvider.overrideWithValue(api),
      homeWidgetSyncProvider.overrideWith((ref) {}),
      detoxProvider.overrideWith((ref) => DetoxController(null)),
    ]);
    addTearDown(() { container.dispose(); api.close(); transport.close(); });
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: const LifeStyleApp(),
    ));
    await tester.pumpAndSettle();
    expect(container.read(authProvider).asData?.value?.id, 'A');
    expect(find.byType(OnboardingScreen), findsOneWidget);

    // Test seam: push the real MoreScreen programmatically instead of reaching
    // it through HomeShell. Then use its real tile to push AnalyticsScreen.
    final navigator = tester.state<NavigatorState>(find.byType(Navigator).first);
    navigator.push(MaterialPageRoute<void>(builder: (_) => const MoreScreen()));
    await tester.pumpAndSettle();
    const labels = AppLocalizations(Locale('en'));
    final tile = find.text(labels.analyticsTitle);
    await tester.ensureVisible(tile);
    await tester.pumpAndSettle();
    await tester.tap(tile);
    await tester.pumpAndSettle();
    expect(find.byType(AnalyticsScreen), findsOneWidget);

    // This forces the controller transition while the pushed route is visible;
    // it is NOT a demonstrated real-user sign-out/sign-in path.
    await container.read(authProvider.notifier).signIn(email: 'B@example.test', password: 'synthetic');
    await tester.pumpAndSettle();
    expect(container.read(authProvider).asData?.value?.id, 'B');
    expect(find.byType(AnalyticsScreen), findsOneWidget,
        reason: 'characterizes whether the pushed route survives the transition');
    expect(tester.takeException(), isNull);
  });
}
