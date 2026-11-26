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

// Regression test using LifeStyleApp with fake auth and mocked HTTP. MoreScreen
// and the profile route are pushed programmatically; real device delivery still
// needs independent verification.
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
      // An existing account isolates link behavior from first-run onboarding.
      onboardingPending: false,
    );

class _Repository extends AuthRepository {
  _Repository(ApiClient api, this.store) : super(api: api, tokens: store);
  final _Tokens store;
  bool loginCalled = false;
  bool logoutCalled = false;
  @override
  Future<AppUser?> restoreSession() async => null;
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
  testWidgets('signed-out cold profile link opens after sign-in', (tester) async {
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
      child: const LifeStyleApp(initialLocation: 'lifestyle:///profile'),
    ));
    await tester.pumpAndSettle();
    expect(find.byType(AuthScreen), findsOneWidget);
    // Synthetic login through the real auth notifier. The original root route
    // was the profile deep link, and no prior account content exists here.
    await container.read(authProvider.notifier).signIn(
      email: 'B@example.test', password: 'synthetic-password');
    await tester.pumpAndSettle();
    expect(container.read(authProvider).asData?.value?.id, 'B');
    expect(find.byType(ProfileScreen), findsOneWidget,
        reason: 'a signed-out cold profile link should survive sign-in');
    expect(tester.takeException(), isNull);
  });
}
