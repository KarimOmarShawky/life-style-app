import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/data/smart_task_parser.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  tearDown(() {
    SmartTaskParser.replyProviderForTesting = null;
  });

  test('parseAsync maps a proxied JSON reply to a scheduled task', () async {
    SmartTaskParser.replyProviderForTesting = (prompt) async {
      expect(prompt, contains('اشتري لبن بكرة الساعة 9'));
      return '{"title":"اشتري لبن","dueDate":"2026-11-09","dueTime":"09:00","hasTime":true}';
    };
    final result = await SmartTaskParser.parseAsync(
      'اشتري لبن بكرة الساعة 9',
      now: DateTime(2026, 11, 8, 12),
    );
    expect(result.title, 'اشتري لبن');
    expect(result.dueDate, '2026-11-09');
    expect(result.dueTime, '09:00');
    expect(result.hasTime, isTrue);
    expect(result.scheduledDateTime, DateTime(2026, 11, 9, 9));
  });

  test('parseAsync tolerates markdown fences around the JSON', () async {
    SmartTaskParser.replyProviderForTesting = (_) async =>
        '```json\n{"title":"Call mom","dueDate":null,"dueTime":null,"hasTime":false}\n```';
    final result = await SmartTaskParser.parseAsync(
      'Call mom',
      now: DateTime(2026, 11, 8, 12),
    );
    expect(result.title, 'Call mom');
    expect(result.dueDate, isNull);
    expect(result.scheduledDateTime, isNull);
  });

  test('parseAsync falls back to the local parser on non-JSON replies',
      () async {
    // The AI facade returns localized fallback text when the backend is
    // unavailable; that text is not JSON and must never be treated as a
    // provider answer.
    SmartTaskParser.replyProviderForTesting =
        (_) async => 'Sorry, I could not process your request right now.';
    final result = await SmartTaskParser.parseAsync(
      'Buy milk tomorrow',
      now: DateTime(2026, 11, 8, 12),
    );
    expect(result.title, isNotEmpty);
    expect(result.title, isNot(contains('Sorry')));
  });

  test('parseAsync falls back to the local parser when the provider throws',
      () async {
    SmartTaskParser.replyProviderForTesting =
        (_) async => throw StateError('offline');
    final result = await SmartTaskParser.parseAsync(
      'Buy milk tomorrow',
      now: DateTime(2026, 11, 8, 12),
    );
    expect(result.title, isNotEmpty);
  });
}
