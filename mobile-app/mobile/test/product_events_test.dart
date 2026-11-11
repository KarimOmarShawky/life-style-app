import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/data/product_events.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';

Map<String, dynamic> _userJson({
  Object? productEventsEnabled = true,
  bool includeEvents = true,
  Object? onboardingCompletedAt = '2026-11-01T08:00:00.000Z',
  bool includeOnboarding = true,
}) =>
    {
      'id': '0b7f2c1e-0000-4000-8000-000000000001',
      'email': 'person@example.test',
      'displayName': 'Person',
      'timezone': 'Africa/Cairo',
      'locale': 'en',
      'defaultCurrency': 'EGP',
      'status': 'active',
      if (includeEvents) 'productEventsEnabled': productEventsEnabled,
      if (includeOnboarding) 'onboardingCompletedAt': onboardingCompletedAt,
    };

void main() {
  group('AppUser capability fields (G1/G5)', () {
    test('a server without the fields shows no onboarding and sends nothing',
        () {
      final user = AppUser.fromJson(
          _userJson(includeEvents: false, includeOnboarding: false));
      expect(user.productEventsEnabled, isNull);
      expect(user.onboardingPending, isFalse);
    });

    test('only an explicit null completion time means onboarding is pending',
        () {
      expect(
          AppUser.fromJson(_userJson(onboardingCompletedAt: null))
              .onboardingPending,
          isTrue);
      expect(AppUser.fromJson(_userJson()).onboardingPending, isFalse);
    });

    test('usage-statistics choice is read as sent', () {
      expect(AppUser.fromJson(_userJson()).productEventsEnabled, isTrue);
      expect(
          AppUser.fromJson(_userJson(productEventsEnabled: false))
              .productEventsEnabled,
          isFalse);
      expect(
          AppUser.fromJson(_userJson(productEventsEnabled: 'yes'))
              .productEventsEnabled,
          isNull);
    });

    test('withOnboardingDone keeps every other field', () {
      final pending = AppUser.fromJson(_userJson(onboardingCompletedAt: null));
      final done = pending.withOnboardingDone();
      expect(done.onboardingPending, isFalse);
      expect(done.id, pending.id);
      expect(done.email, pending.email);
      expect(done.productEventsEnabled, isTrue);
      expect(done.status, pending.status);
    });
  });

  group('ProductEventsClient', () {
    late List<Map<String, Object>> sent;
    late DateTime now;
    late ProductEventsClient client;

    setUp(() {
      sent = <Map<String, Object>>[];
      now = DateTime(2026, 11, 10, 9);
      client = ProductEventsClient(
        send: (body) async => sent.add(body),
        clock: () => now,
        platform: TargetPlatform.android,
      );
    });

    test('bodies carry only the event name, platform and app version',
        () async {
      client.record(AppUser.fromJson(_userJson()), ProductEvent.taskCompleted);
      await Future<void>.delayed(Duration.zero);
      expect(sent, [
        {
          'event': 'task_completed',
          'platform': 'android',
          'appVersion': appVersion,
        },
      ]);
    });

    test('nothing is sent when opted out, unsupported or signed out', () async {
      client.record(AppUser.fromJson(_userJson(productEventsEnabled: false)),
          ProductEvent.appOpened);
      client.record(AppUser.fromJson(_userJson(includeEvents: false)),
          ProductEvent.appOpened);
      client.record(null, ProductEvent.appOpened);
      await Future<void>.delayed(Duration.zero);
      expect(sent, isEmpty);
    });

    test('one request per account, event and day', () async {
      final user = AppUser.fromJson(_userJson());
      client.record(user, ProductEvent.appOpened);
      client.record(user, ProductEvent.appOpened);
      client.record(user, ProductEvent.habitCheckedIn);
      await Future<void>.delayed(Duration.zero);
      expect(sent.map((body) => body['event']),
          ['app_opened', 'habit_checked_in']);
      now = DateTime(2026, 11, 11, 9);
      client.record(user, ProductEvent.appOpened);
      await Future<void>.delayed(Duration.zero);
      expect(sent, hasLength(3));
    });

    test('a failed send never throws and can be retried', () async {
      var fail = true;
      final attempts = <String>[];
      final flaky = ProductEventsClient(
        send: (body) async {
          attempts.add(body['event']! as String);
          if (fail) throw StateError('offline');
        },
        clock: () => now,
      );
      final user = AppUser.fromJson(_userJson());
      flaky.record(user, ProductEvent.onboardingStarted);
      await Future<void>.delayed(Duration.zero);
      fail = false;
      flaky.record(user, ProductEvent.onboardingStarted);
      await Future<void>.delayed(Duration.zero);
      expect(attempts, ['onboarding_started', 'onboarding_started']);
    });

    test('wire names match the backend closed list', () {
      expect(ProductEvent.values.map((event) => event.wireName), [
        'app_opened',
        'onboarding_started',
        'onboarding_completed',
        'onboarding_skipped',
        'task_completed',
        'habit_checked_in',
      ]);
    });

    test('appVersion matches pubspec.yaml and the server pattern', () {
      final pubspec = File('pubspec.yaml').readAsStringSync();
      final version =
          RegExp(r'^version:\s*(\S+)\s*$', multiLine: true).firstMatch(pubspec);
      expect(version?.group(1), appVersion);
      expect(RegExp(r'^[0-9A-Za-z.+-]{1,32}$').hasMatch(appVersion), isTrue);
    });
  });
}
