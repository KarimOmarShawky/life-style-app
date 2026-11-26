import 'dart:convert';
import 'package:flutter/services.dart';

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
import 'package:lifestyle_mobile/features/auth/presentation/auth_screen.dart';
import 'package:lifestyle_mobile/features/auth/presentation/profile_screen.dart';
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
  bool loginCalled = false;
  bool logoutCalled = false;
  @override
  Future<AppUser?> restoreSession() async => _user('A');
  @override
  Future<void> logout() async { logoutCalled = true; await store.clear(); }
  @override
  Future<AppUser> login({required String email, required String password}) async {
    loginCalled = true;
    await store.write(_token('B'));
    return _user('B');
  }
}

void main() {
  testWidgets('characterizes profile logout and login above synthetic analytics', (tester) async {
    SharedPreferences.setMockInitialValues({'app_locale': 'en'});
    const secureChannel = MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
    final secureCalls = <String>[];
    const shieldChannel = MethodChannel('com.example.lifestyle_mobile/focus_shield');
    const reminderChannel = MethodChannel('com.example.lifestyle_mobile/native_voice');
    const shieldEventsChannel = MethodChannel('com.example.lifestyle_mobile/focus_shield/events');
    final platformCalls = <String>[];
    final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(shieldChannel, (call) async {
      platformCalls.add('shield:${call.method}');
      return <String, dynamic>{'schemaVersion': 1};
    });
    messenger.setMockMethodCallHandler(shieldEventsChannel, (call) async {
      platformCalls.add('shieldEvents:${call.method}');
      return null;
    });
    messenger.setMockMethodCallHandler(reminderChannel, (call) async {
      platformCalls.add('reminder:${call.method}');
      return null;
    });
    addTearDown(() {
      messenger.setMockMethodCallHandler(shieldChannel, null);
      messenger.setMockMethodCallHandler(shieldEventsChannel, null);
      messenger.setMockMethodCallHandler(reminderChannel, null);
    });
    messenger.setMockMethodCallHandler(secureChannel, (call) async {
      secureCalls.add(call.method);
      return null;
    });
    addTearDown(() => messenger.setMockMethodCallHandler(secureChannel, null));
    final store = _Tokens();
    final requests = <http.Request>[];
    final transport = MockClient((request) async {
      requests.add(request);
      if (request.method != 'GET' || request.url.path != '/api/v1/analytics' ||
          request.headers['authorization'] != 'Bearer synthetic-access-A') {
        throw StateError('Unexpected synthetic request');
      }
      return http.Response(jsonEncode({
        'success': true,
        'data': {'analytics': {
          'rangeDays': 7, 'from': '2026-11-01', 'to': '2026-11-07',
          'tasks': {'completedInRange': 987, 'createdInRange': 988},
          'habits': <String, Object>{}, 'focus': <String, Object>{},
          'goals': <String, Object>{}, 'subscriptions': <String, Object>{},
          'series': <Object>[],
        }},
      }), 200, headers: {'content-type': 'application/json'});
    });
    final api = ApiClient(
      baseUri: Uri.parse('https://api.example.test/api/v1/'),
      tokenStore: store,
      httpClient: transport,
    );
    final repo = _Repository(api, store);
    final container = ProviderContainer(overrides: [
      authRepositoryProvider.overrideWithValue(repo),
      apiClientProvider.overrideWithValue(api),
      homeWidgetSyncProvider.overrideWith((ref) {}),
      detoxProvider.overrideWith((ref) => DetoxController(null)),
      retiredDataCleanupProvider.overrideWithValue(() async {}),
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
    expect(requests, hasLength(1));
    expect(find.text('987'), findsOneWidget, reason: 'synthetic A metric loaded');

    // Simulates a named route arriving while analytics is open. This is not
    // evidence that a platform deep link can actually deliver this route.
    navigator.pushNamed('/profile');
    await tester.pumpAndSettle();
    expect(find.byType(ProfileScreen), findsOneWidget);
    final logout = find.widgetWithText(OutlinedButton, labels.signOut);
    await tester.scrollUntilVisible(
      logout, 400,
      scrollable: find.descendant(
        of: find.byType(ProfileScreen), matching: find.byType(Scrollable)),
    );
    await tester.pumpAndSettle();
    await tester.tap(logout);
    await tester.pumpAndSettle();
    expect(container.read(authProvider).asData?.value, isNull);
    expect(find.byType(AuthScreen), findsOneWidget);
    expect(store.value, isNull);
    // Signed-out UI can appear before asynchronous sign-out cleanup completes.
    // Allow a bounded real-time interval for widget-test platform work.
    await tester.runAsync(() async {
      await Future<void>.delayed(const Duration(milliseconds: 500));
    });
    await tester.pump();
    debugPrint('DIAGNOSTIC secureCalls=$secureCalls platformCalls=$platformCalls');

    final fields = find.descendant(of: find.byType(AuthScreen), matching: find.byType(TextFormField));
    expect(fields, findsNWidgets(2));
    await tester.enterText(fields.at(0), 'B@example.test');
    await tester.enterText(fields.at(1), 'synthetic-password');
    final login = find.widgetWithText(FilledButton, labels.signIn);
    await tester.ensureVisible(login);
    final signalBefore = container.read(authTransitionSignalProvider);
    await tester.tap(login);
    // A spinner can keep pumpAndSettle alive; bounded pumps expose state.
    for (var i = 0; i < 50; i++) {
      await tester.pump(const Duration(milliseconds: 100));
      if (container.read(authProvider).asData?.value?.id == 'B') break;
    }
    final auth = container.read(authProvider);
    debugPrint('DIAGNOSTIC signalBefore=$signalBefore signalAfter=${container.read(authTransitionSignalProvider)} secureCallsAfter=$secureCalls platformCallsAfter=$platformCalls logoutCalled=${repo.logoutCalled} loginCalled=${repo.loginCalled} isLoading=${auth.isLoading} hasError=${auth.hasError} account=${auth.asData?.value?.id}');
    expect(container.read(authProvider).asData?.value?.id, 'B');
    expect(store.value?.accessToken, 'synthetic-access-B');

    // Return to the route underneath the profile/session route.
    navigator.pop();
    await tester.pumpAndSettle();
    expect(find.byType(AnalyticsScreen), findsOneWidget);
    expect(find.text('987'), findsOneWidget,
        reason: 'characterizes retained synthetic A metric after B login');
    expect(requests, hasLength(1), reason: 'no B analytics request occurred');
    expect(tester.takeException(), isNull);
  });
}
