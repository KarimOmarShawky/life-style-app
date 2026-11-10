import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Source contract for lock-screen privacy (feature guide P0-F1) and
/// permission timing (P0-F5). The notification plugin cannot run in unit
/// tests, so the rules are checked on the code that builds notifications.
void main() {
  final dartFiles = Directory('lib')
      .listSync(recursive: true)
      .whereType<File>()
      .where((file) => file.path.endsWith('.dart'))
      .toList();
  final service = File('lib/data/notification_service.dart').readAsStringSync();

  test('every Android notification hides content on secure lock screens', () {
    var details = 0;
    for (final file in dartFiles) {
      final source = file.readAsStringSync();
      for (final match
          in RegExp(r'AndroidNotificationDetails\(').allMatches(source)) {
        details++;
        expect(
          _balanced(source, match.end - 1),
          contains('visibility: NotificationVisibility.private'),
          reason: '${file.path} at offset ${match.start}',
        );
      }
    }
    expect(details, greaterThanOrEqualTo(4));
  });

  test('permissions are never requested at launch or from background work', () {
    final init = _balanced(
        service, service.indexOf('{', service.indexOf('Future<void> init()')));
    expect(init, isNot(contains('Permission(')));
    expect(init, isNot(contains('IfNeeded(')));
    final action = _balanced(
        service,
        service.indexOf(
            '{', service.indexOf('Future<void> handleNotificationAction(')));
    expect(action, isNot(contains('IfNeeded(')));
    for (final path in [
      'lib/main.dart',
      'lib/app.dart',
      'lib/features/home/presentation/home_shell.dart',
    ]) {
      expect(File(path).readAsStringSync(),
          isNot(contains('requestPermissionsIfNeeded(')),
          reason: path);
    }
    for (final file in dartFiles) {
      if (file.path.endsWith('notification_service.dart')) continue;
      final source = file.readAsStringSync();
      expect(source, isNot(contains('requestNotificationsPermission')),
          reason: file.path);
      expect(source, isNot(contains('requestExactAlarmsPermission')),
          reason: file.path);
    }
  });

  test('task alarms keep the task name out of the notification title', () {
    final tasks = File('lib/features/tasks/presentation/tasks_screen.dart')
        .readAsStringSync();
    final calls = RegExp(r'\.scheduleAlarm\(').allMatches(tasks).toList();
    expect(calls, isNotEmpty);
    for (final match in calls) {
      expect(_balanced(tasks, match.end - 1),
          contains('title: l10n.taskReminderTitle'));
    }
  });
}

/// The source text from the bracket at [open] through its matching bracket.
String _balanced(String source, int open) {
  final opening = source[open];
  final closing = opening == '(' ? ')' : '}';
  var depth = 0;
  for (var i = open; i < source.length; i++) {
    if (source[i] == opening) depth++;
    if (source[i] == closing && --depth == 0) {
      return source.substring(open, i + 1);
    }
  }
  throw StateError('Unbalanced bracket at $open');
}
