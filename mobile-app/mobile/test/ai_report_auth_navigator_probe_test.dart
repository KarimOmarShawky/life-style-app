import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_reports_client.dart';
import 'package:lifestyle_mobile/features/ai/presentation/ai_report_sheet.dart';
import 'package:lifestyle_mobile/features/auth/data/auth_repository.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

// Characterization probe: real AuthController, Navigator and report sheet,
// but a minimal host, fake repository and mock HTTP. The transition is invoked
// programmatically under the modal, not through the real user-facing UI.
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
  testWidgets('characterizes a modal across a real controller transition', (tester) async {
    const labels = AppLocalizations(Locale('en'));
    const reply = 'Synthetic A reply';
    final requests = <http.Request>[];
    final store = _Tokens();
    final transport = MockClient((request) async {
      requests.add(request);
      return http.Response(
        jsonEncode({'success': true, 'data': {'reported': true}}),
        201,
        headers: {'content-type': 'application/json'},
      );
    });
    final api = ApiClient(
      baseUri: Uri.parse('https://api.example.test/api/v1/'),
      tokenStore: store,
      httpClient: transport,
    );
    final container = ProviderContainer(overrides: [
      authRepositoryProvider.overrideWithValue(_Repository(api, store)),
      aiReportsClientProvider.overrideWithValue(ApiAiReportsClient(api)),
    ]);
    addTearDown(() { container.dispose(); api.close(); transport.close(); });
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        locale: const Locale('en'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: Consumer(builder: (context, ref, _) {
          final auth = ref.watch(authProvider);
          return Scaffold(body: auth.when(
            loading: () => const Text('loading'),
            error: (_, __) => const Text('auth error'),
            data: (user) => user?.id == 'A'
                ? const AiReportButton(surface: AiReportSurface.assistant, replyText: reply)
                : Text('account ${user?.id}'),
          ));
        }),
      ),
    ));
    await tester.pumpAndSettle();
    expect(container.read(authProvider).asData?.value?.id, 'A');
    await tester.tap(find.byTooltip(labels.aiReportReplyTooltip));
    await tester.pumpAndSettle();
    expect(find.text(labels.aiReportTitle), findsOneWidget);

    // Invoke the production controller, not an actual sign-out/sign-in UI.
    await container.read(authProvider.notifier).signIn(email: 'B@example.test', password: 'synthetic');
    await tester.pumpAndSettle();
    expect(container.read(authProvider).asData?.value?.id, 'B');
    expect(find.text(labels.aiReportTitle), findsOneWidget,
        reason: 'characterizes whether the Navigator retained the modal');
    await tester.tap(find.text(labels.aiReportCategoryOther));
    await tester.pumpAndSettle();
    final send = find.widgetWithText(FilledButton, labels.aiReportSend);
    await tester.ensureVisible(send);
    await tester.pumpAndSettle();
    await tester.tap(send);
    await tester.pumpAndSettle();
    expect(requests, hasLength(1));
    expect(requests.single.headers['authorization'], 'Bearer synthetic-access-B');
    expect(jsonDecode(requests.single.body), containsPair('replyText', reply));
    expect(tester.takeException(), isNull);
  });
}
