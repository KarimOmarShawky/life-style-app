import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/features/timer/data/timer_session_model.dart';

void main() {
  test('a focus session without a task parses with a null taskId', () {
    final session = TimerSession.fromJson({
      'id': '11111111-1111-4111-8111-111111111111',
      'taskId': null,
      'startedAt': '2026-10-09T10:00:00.000Z',
      'endedAt': null,
      'mode': 'stopwatch',
      'durationSeconds': 0,
      'endReason': null,
    });

    expect(session.taskId, isNull);
    expect(session.isRunning, isTrue);
  });
}
