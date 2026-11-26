import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_memory_client.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_settings_client.dart';
import 'package:lifestyle_mobile/features/ai/presentation/ai_memory_screen.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

class _Auth extends AuthController {
  @override
  Future<AppUser?> build() async => AppUser.fromJson({
        'id': 'test-user', 'email': 'test@example.test',
        'displayName': 'Test', 'timezone': 'UTC', 'locale': 'en',
        'defaultCurrency': 'USD', 'status': 'active',
      });
}

class _Settings implements AiSettingsClient {
  static const value = AiSettingsSnapshot(
    consentVersion: 1, currentConsentVersion: 1, available: true,
    memoryEnabled: true, explicitMemoryEnabled: true,
  );
  @override
  Future<AiSettingsSnapshot> fetch() async => value;
  @override
  Future<AiSettingsSnapshot> grantConsent() async => value;
  @override
  Future<AiSettingsSnapshot> withdrawConsent() async => value;
  @override
  Future<AiSettingsSnapshot> setMemoryEnabled(bool enabled) async => value;
}

// Test-only credential store. Fail closed when the supplied guard is stale.
class _GuardedTokens implements SessionBoundTokenStore {
  SessionTokens? value = SessionTokens(
    accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh',
    accessTokenExpiresAt: DateTime.utc(2030),
    refreshTokenExpiresAt: DateTime.utc(2030),
  );
  void _check(bool Function() current) {
    if (!current()) throw const StaleCredentialOperation();
  }
  @override
  Future<SessionTokens?> read() async => value;
  @override
  Future<void> write(SessionTokens tokens) async { value = tokens; }
  @override
  Future<void> clear() async { value = null; }
  @override
  Future<SessionTokens?> readForSession(bool Function() current) async {
    _check(current);
    return value;
  }
  @override
  Future<void> writeForSession(SessionTokens tokens, bool Function() current) async {
    _check(current);
    value = tokens;
  }
  @override
  Future<void> clearForSession(bool Function() current) async {
    _check(current);
    value = null;
  }
  @override
  Future<bool> clearIfMatches(SessionTokens expected, bool Function() current) async {
    _check(current);
    if (!identical(value, expected)) return false;
    value = null;
    return true;
  }
  @override
  Future<bool> replaceIfMatches(SessionTokens expected, SessionTokens replacement,
      bool Function() current) async {
    _check(current);
    if (!identical(value, expected)) return false;
    value = replacement;
    return true;
  }
}

void main() {
  testWidgets('guarded memory creation sends one synthetic note', (tester) async {
    SharedPreferences.setMockInitialValues({'app_locale': 'en'});
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      final data = request.method == 'GET'
          ? {'items': [], 'available': true}
          : {'id': 'test-note', 'kind': 'preference', 'content': 'Keep answers short'};
      return http.Response(jsonEncode({'success': true, 'data': data}), 200,
          headers: {'content-type': 'application/json'});
    });
    final api = ApiClient(
      baseUri: Uri.parse('https://api.example.test/api/v1/'),
      tokenStore: _GuardedTokens(), httpClient: client,
    );
    addTearDown(api.close);
    await tester.pumpWidget(ProviderScope(
      overrides: [
        authProvider.overrideWith(_Auth.new),
        aiSettingsClientProvider.overrideWithValue(_Settings()),
        aiMemoryClientProvider.overrideWithValue(ApiAiMemoryClient(api)),
      ],
      child: MaterialApp(
        locale: const Locale('en'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate, GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
        ],
        home: Consumer(builder: (context, ref, _) {
          ref.watch(authProvider);
          return const AiMemoryScreen();
        }),
      ),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('ai-memory-add')));
    await tester.pumpAndSettle();
    const labels = AppLocalizations(Locale('en'));
    await tester.tap(find.text(labels.aiMemoryKindPreference));
    await tester.enterText(find.byKey(const ValueKey('ai-memory-field')),
        '  Keep answers short  ');
    await tester.pump();
    final save = find.widgetWithText(FilledButton, labels.save);
    await tester.ensureVisible(save);
    await tester.tap(save);
    await tester.pumpAndSettle();
    final posts = requests.where((r) => r.method == 'POST').toList();
    expect(posts, hasLength(1));
    expect(posts.single.url.path, '/api/v1/ai/memories');
    expect(posts.single.headers['authorization'], 'Bearer synthetic-access');
    expect(jsonDecode(posts.single.body),
        {'kind': 'preference', 'content': 'Keep answers short'});
    expect(find.text('Keep answers short'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
