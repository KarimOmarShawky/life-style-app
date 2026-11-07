import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_transport.dart';

/// Offline transport double: replays a fixed reply or failure.
class _FakeTransport implements AiTransport {
  _FakeTransport({this.reply, this.error});

  final String? reply;
  final AiTransportException? error;
  int calls = 0;

  @override
  Future<String> chat({
    required List<ChatMessage> history,
    required String message,
    required String languageName,
    required AiReplyMode mode,
    Duration timeout = const Duration(seconds: 30),
  }) async {
    calls++;
    final failure = error;
    if (failure != null) throw failure;
    return reply!;
  }

  @override
  Stream<String> chatStream({
    required List<ChatMessage> history,
    required String message,
    required String languageName,
    Duration timeout = const Duration(seconds: 60),
  }) async* {
    calls++;
    final failure = error;
    if (failure != null) throw failure;
    yield reply!;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('cumulative analysis returns model text on success', () async {
    final service = AiService.forTesting(
      transport: _FakeTransport(reply: 'Real analysis'),
    );
    final result = await service.getCumulativeAnalysis(
      aggregates: const {'tasksCompleted': 3},
      weeklyTrends: const [],
      timeRange: '7 days',
      languageName: 'English',
    );
    expect(result, 'Real analysis');
  });

  test('provider failure is null, never fallback text dressed as analysis',
      () async {
    final service = AiService.forTesting(
      transport:
          _FakeTransport(error: const AiTransportException('unavailable')),
    );
    final result = await service.getCumulativeAnalysis(
      aggregates: const {'tasksCompleted': 3},
      weeklyTrends: const [],
      timeRange: '7 days',
      languageName: 'English',
    );
    expect(result, isNull);

    final dashboard = await service.getPerformanceDashboard(
      metrics: const {'tasksCompleted': 3},
      streaks: const {},
      highlights: const {},
      languageName: 'English',
    );
    expect(dashboard, isNull);
  });
}
