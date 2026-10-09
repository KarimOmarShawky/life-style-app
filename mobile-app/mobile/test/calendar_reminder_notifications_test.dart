import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/features/calendar/data/calendar_reminder_notifications.dart';

void main() {
  test('a reminder keeps the same notification id and stays in the int32 range', () {
    const reminderId = '6f1c2d3e-0000-4000-8000-000000000001';

    final first = calendarReminderNotificationId(reminderId);
    final again = calendarReminderNotificationId(reminderId);

    expect(first, again);
    expect(first, greaterThanOrEqualTo(0x40000000));
    expect(first, lessThanOrEqualTo(0x7fffffff));
  });

  test('different reminders get different notification ids', () {
    final ids = <int>{
      for (var i = 0; i < 50; i++) calendarReminderNotificationId('reminder-$i'),
    };

    expect(ids, hasLength(50));
  });
}
