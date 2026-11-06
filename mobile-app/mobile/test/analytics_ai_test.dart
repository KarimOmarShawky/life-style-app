import 'support/fake_secure_storage.dart';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';

class _FakeClient extends http.BaseClient {
  _FakeClient(this.statusCode, this.body);

  final int statusCode;
  final String body;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    return http.StreamedResponse(
      Stream.value(utf8.encode(body)),
      statusCode,
      headers: {'content-type': 'application/json'},
    );
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    FakeSecureStorage().install();
  });

  final service = AiService.instance;

  setUp(() async {
    service.resetFailureCount();
    await service.setUserApiKey('test-only-analytics-key');
  });

  tearDown(() async {
    await service.setUserApiKey(null);
    service.resetFailureCount();
  });

  test('cumulative analysis returns model text on success', () async {
    final client = _FakeClient(
      200,
      jsonEncode({
        'candidates': [
          {
            'content': {
              'parts': [
                {'text': 'Real analysis'}
              ]
            }
          }
        ]
      }),
    );
    final result = await service.getCumulativeAnalysis(
      aggregates: const {'tasksCompleted': 3},
      weeklyTrends: const [],
      timeRange: '7 days',
      languageName: 'English',
      httpClient: client,
    );
    expect(result, 'Real analysis');
  });

  test('provider failure is null, never fallback text dressed as analysis',
      () async {
    final client = _FakeClient(500, '{"error":"boom"}');
    final result = await service.getCumulativeAnalysis(
      aggregates: const {'tasksCompleted': 3},
      weeklyTrends: const [],
      timeRange: '7 days',
      languageName: 'English',
      httpClient: client,
    );
    expect(result, isNull);

    final dashboard = await service.getPerformanceDashboard(
      metrics: const {'tasksCompleted': 3},
      streaks: const {},
      highlights: const {},
      languageName: 'English',
      httpClient: client,
    );
    expect(dashboard, isNull);
  });
}
