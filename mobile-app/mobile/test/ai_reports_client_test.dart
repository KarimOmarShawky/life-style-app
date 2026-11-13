import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_reports_client.dart';
import 'package:lifestyle_mobile/features/ai/data/text_limits.dart';

/// Slice AI-P: in-app reports of AI output (POST /api/v1/ai/reports).

class _MemoryTokenStore implements TokenStore {
  _MemoryTokenStore(this.tokens);

  SessionTokens? tokens;

  @override
  Future<void> clear() async {
    tokens = null;
  }

  @override
  Future<SessionTokens?> read() async => tokens;

  @override
  Future<void> write(SessionTokens value) async {
    tokens = value;
  }
}

SessionTokens _tokens() => SessionTokens(
      accessToken: 'access',
      refreshToken: 'refresh',
      accessTokenExpiresAt: DateTime.utc(2030),
      refreshTokenExpiresAt: DateTime.utc(2030),
    );

const _created = {
  'success': true,
  'data': {'reported': true},
};

const _unavailable = {
  'success': false,
  'error': {'code': 'AI_REPORTS_UNAVAILABLE', 'message': 'later'},
};

http.Response _json(Object body, int status) => http.Response(
      jsonEncode(body),
      status,
      headers: {'content-type': 'application/json'},
    );

void main() {
  late List<http.Request> requests;
  late http.Response Function(http.Request request) respond;

  ApiAiReportsClient client() => ApiAiReportsClient(ApiClient(
        baseUri: Uri.parse('https://api.example.test/api/v1/'),
        tokenStore: _MemoryTokenStore(_tokens()),
        httpClient: MockClient((request) async {
          requests.add(request);
          return respond(request);
        }),
      ));

  setUp(() {
    requests = [];
    respond = (_) => _json(_created, 201);
  });

  test('posts the surface, category, locale, reply and a trimmed note',
      () async {
    await client().submit(
      surface: AiReportSurface.weeklyCoaching,
      category: AiReportCategory.inaccurate,
      locale: 'ar',
      replyText: '  Sleep earlier.  ',
      note: '  wrong numbers ',
    );
    final request = requests.single;
    expect(request.method, 'POST');
    expect(request.url.path, '/api/v1/ai/reports');
    expect(request.headers['authorization'], 'Bearer access');
    expect(jsonDecode(request.body), {
      'surface': 'weekly_coaching',
      'category': 'inaccurate',
      'locale': 'ar',
      'replyText': 'Sleep earlier.',
      'note': 'wrong numbers',
    });
  });

  test('leaves out a reply that was not included and an empty note', () async {
    await client().submit(
      surface: AiReportSurface.assistant,
      category: AiReportCategory.other,
      locale: 'en',
      note: '   ',
    );
    expect(jsonDecode(requests.single.body), {
      'surface': 'assistant',
      'category': 'other',
      'locale': 'en',
    });
  });

  test('cuts long text to the backend limits', () async {
    await client().submit(
      surface: AiReportSurface.analyticsInsight,
      category: AiReportCategory.spam,
      locale: 'de',
      replyText: 'r' * 5000,
      note: 'n' * 900,
    );
    final body = jsonDecode(requests.single.body) as Map<String, Object?>;
    expect(body['surface'], 'analytics_insight');
    expect((body['replyText']! as String).length, aiReportReplyMaxChars);
    expect((body['note']! as String).length, aiReportNoteMaxChars);
  });

  test('a server refusal reaches the caller as an ApiException', () async {
    respond = (_) => _json(_unavailable, 503);
    await expectLater(
      client().submit(
        surface: AiReportSurface.assistant,
        category: AiReportCategory.harmful,
        locale: 'en',
      ),
      throwsA(isA<ApiException>()),
    );
  });

  test('clampUtf16 never splits an emoji', () {
    // Each emoji is two UTF-16 code units.
    final text = 'ab${'\u{1F600}' * 3}';
    expect(clampUtf16(text, 3), 'ab');
    expect(clampUtf16(text, 4), 'ab\u{1F600}');
    expect(clampUtf16('short', 10), 'short');
  });
}
