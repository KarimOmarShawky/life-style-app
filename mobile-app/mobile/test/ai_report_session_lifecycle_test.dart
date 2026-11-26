import 'dart:async';
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
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

// Characterization of the shared report sheet with synthetic credentials and
// HTTP. The host deliberately keeps the sheet open across a simulated identity
// transition; this does not prove real application navigation can do so.
class _Tokens implements TokenStore {
  _Tokens(this.value);
  SessionTokens? value;

  @override
  Future<SessionTokens?> read() async => value;
  @override
  Future<void> write(SessionTokens tokens) async => value = tokens;
  @override
  Future<void> clear() async => value = null;
}

SessionTokens _tokens(String id) => SessionTokens(
      accessToken: 'synthetic-access-$id',
      refreshToken: 'synthetic-refresh-$id',
      accessTokenExpiresAt: DateTime.utc(2030),
      refreshTokenExpiresAt: DateTime.utc(2030),
    );

void main() {
  const labels = AppLocalizations(Locale('en'));
  const reply = 'Synthetic reply belonging to the first session';

  test('a response after a session transition is rejected locally', () async {
    final sent = Completer<http.Request>();
    final response = Completer<http.Response>();
    final transport = MockClient((request) {
      sent.complete(request);
      return response.future;
    });
    addTearDown(transport.close);
    final api = ApiClient(
      baseUri: Uri.parse('https://api.example.test/api/v1/'),
      tokenStore: _Tokens(_tokens('A')),
      httpClient: transport,
    );
    final submission = ApiAiReportsClient(api).submit(
      surface: AiReportSurface.assistant,
      category: AiReportCategory.other,
      locale: 'en',
      replyText: reply,
    );
    final request = await sent.future;
    expect(request.headers['authorization'], 'Bearer synthetic-access-A');
    api.invalidateSessionRetries();
    response.complete(http.Response(
      jsonEncode({'success': true, 'data': {'reported': true}}),
      201,
      headers: {'content-type': 'application/json'},
    ));
    await expectLater(
      submission,
      throwsA(isA<ApiException>().having((e) => e.code, 'code', 'SESSION_CHANGED')),
    );
    // The mock has already received the request. Local rejection cannot undo
    // any effect a real server may have performed before responding.
  });

  for (final surface in AiReportSurface.values) {
    testWidgets('characterizes retained $surface sheet after A to B',
        (tester) async {
      final store = _Tokens(_tokens('A'));
      final requests = <http.Request>[];
      final transport = MockClient((request) async {
        requests.add(request);
        return http.Response(
          jsonEncode({'success': true, 'data': {'reported': true}}),
          201,
          headers: {'content-type': 'application/json'},
        );
      });
      addTearDown(transport.close);
      final api = ApiClient(
        baseUri: Uri.parse('https://api.example.test/api/v1/'),
        tokenStore: store,
        httpClient: transport,
      );

      await tester.pumpWidget(ProviderScope(
        overrides: [
          aiReportsClientProvider.overrideWithValue(ApiAiReportsClient(api)),
        ],
        child: MaterialApp(
          locale: const Locale('en'),
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: Scaffold(
            body: AiReportButton(surface: surface, replyText: reply),
          ),
        ),
      ));
      await tester.tap(find.byTooltip(labels.aiReportReplyTooltip));
      await tester.pumpAndSettle();
      expect(find.text(labels.aiReportTitle), findsOneWidget);

      // Explicitly simulate the transition after opening the sheet. This fake
      // does not exercise the real auth controller or navigation lifecycle.
      api.invalidateSessionRetries();
      await store.write(_tokens('B'));
      await tester.tap(find.text(labels.aiReportCategoryOther));
      await tester.pumpAndSettle();
      final send = find.widgetWithText(FilledButton, labels.aiReportSend);
      await tester.ensureVisible(send);
      await tester.pumpAndSettle();
      await tester.tap(send);
      await tester.pumpAndSettle();

      // Characterizes current behavior, not a security assertion or a fix.
      expect(requests, hasLength(1));
      expect(requests.single.headers['authorization'],
          'Bearer synthetic-access-B');
      expect(jsonDecode(requests.single.body), containsPair('replyText', reply));
      expect(jsonDecode(requests.single.body), containsPair('surface', surface.wire));
      expect(tester.takeException(), isNull);
    });
  }
}
