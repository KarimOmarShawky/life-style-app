import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/data/notification_policy.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;

/// Feature guide G2 (ADR-046): the Dart policy must give the same answers as
/// the server policy, case for case (backend/tests/unit/notification-policy
/// .test.ts reads the same file).
void main() {
  setUpAll(tzdata.initializeTimeZones);

  final fixture = jsonDecode(
    File('test/fixtures/notification_policy_cases.json').readAsStringSync(),
  ) as Map<String, Object?>;
  final decisionCases = (fixture['decisionCases']! as List<Object?>)
      .cast<Map<String, Object?>>();
  final summaryCases = (fixture['summaryCases']! as List<Object?>)
      .cast<Map<String, Object?>>();

  NotificationPreferences preferencesFrom(Map<String, Object?> raw) {
    final start = raw['quietStart'];
    final end = raw['quietEnd'];
    final cap = raw['dailyCap'];
    final base = const NotificationPreferences().copyWith(
      notificationsEnabled: raw['notificationsEnabled'] as bool?,
      digestEnabled: raw['digestEnabled'] as bool?,
      criticalBreaksQuiet: raw['criticalBreaksQuiet'] as bool?,
    );
    final withQuiet = base.withQuietHours(
      start is String ? parseClockMinute(start) : null,
      end is String ? parseClockMinute(end) : null,
    );
    return withQuiet.withDailyCap(cap is int ? cap : null);
  }

  NotificationTier tierFrom(String name) =>
      NotificationTier.values.firstWhere((tier) => tier.name == name);

  String iso(DateTime value) => value.toUtc().toIso8601String();

  Map<String, String> summarize(NotificationDecision decision) {
    if (decision is AllowNotification) {
      return {'action': 'allow', 'at': iso(decision.at)};
    }
    if (decision is DelayNotification) {
      return {'action': 'delay', 'at': iso(decision.at)};
    }
    if (decision is DigestNotification) {
      return {'action': 'digest', 'localDate': decision.localDate};
    }
    return {'action': 'drop'};
  }

  Map<String, String> expected(Map<String, Object?> raw) {
    final at = raw['at'];
    final localDate = raw['localDate'];
    return {
      'action': raw['action']! as String,
      if (at is String) 'at': iso(DateTime.parse(at)),
      if (localDate is String) 'localDate': localDate,
    };
  }

  test('loads the shared, versioned case file', () {
    expect(fixture['version'], 1);
    expect(decisionCases.length, greaterThanOrEqualTo(20));
    expect(summaryCases.length, greaterThanOrEqualTo(2));
  });

  for (final testCase in decisionCases) {
    test(testCase['name']! as String, () {
      final delivered =
          (testCase['deliveredOn'] as Map<String, Object?>?) ?? const {};
      final decision = decideNotification(
        tier: tierFrom(testCase['tier']! as String),
        at: DateTime.parse(testCase['at']! as String),
        timeZone: testCase['timeZone']! as String,
        preferences: preferencesFrom(
          testCase['preferences']! as Map<String, Object?>,
        ),
        deliveredOn: (day) => (delivered[day] as int?) ?? 0,
      );
      expect(
        summarize(decision),
        expected(testCase['expect']! as Map<String, Object?>),
      );
    });
  }

  for (final testCase in summaryCases) {
    test('summary: ${testCase['name']}', () {
      final at = summaryDeliveryAt(
        DateTime.parse(testCase['firstItemAt']! as String),
        testCase['timeZone']! as String,
        preferencesFrom(testCase['preferences']! as Map<String, Object?>),
      );
      final expectAt = DateTime.parse(testCase['expectAt']! as String);
      expect(iso(at), iso(expectAt));
    });
  }

  test('reads and writes the API shape, rejecting malformed values', () {
    final prefs = NotificationPreferences.fromJson(const {
      'notificationsEnabled': true,
      'quietHours': {'start': '22:00', 'end': '07:00'},
      'dailyLimit': 5,
      'digestEnabled': false,
      'criticalBreaksQuiet': true,
    });
    expect(prefs.quietStartMinute, 1320);
    expect(prefs.quietEndMinute, 420);
    expect(prefs.toJson(), {
      'notificationsEnabled': true,
      'quietHours': {'start': '22:00', 'end': '07:00'},
      'dailyLimit': 5,
      'digestEnabled': false,
      'criticalBreaksQuiet': true,
    });
    final broken = NotificationPreferences.fromJson(const {
      'quietHours': {'start': '25:00', 'end': '07:00'},
      'dailyLimit': 99,
    });
    expect(broken, NotificationPreferences.defaults);
    expect(parseClockMinute('7:00'), isNull);
    expect(formatClockMinute(-1), '23:59');
  });
}
