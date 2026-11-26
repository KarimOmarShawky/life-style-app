import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/auth/data/user_model.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;

import 'package:lifestyle_mobile/data/notification_policy.dart';
import 'package:lifestyle_mobile/data/notification_scheduler.dart';

class _Scheduled {
  const _Scheduled(this.type, this.at, {this.title, this.count});

  final String type;
  final DateTime at;
  final String? title;
  final int? count;
}

class _FakeSink implements NotificationSink {
  final Map<int, _Scheduled> scheduled = {};

  @override
  Future<void> showReminderAt({
    required int id,
    required ReminderKind kind,
    required String title,
    required String body,
    required DateTime at,
  }) async {
    scheduled[id] = _Scheduled('reminder', at.toUtc(), title: title);
  }

  @override
  Future<void> showAlarmAt({
    required int id,
    required String title,
    required String body,
    required DateTime at,
  }) async {
    scheduled[id] = _Scheduled('alarm', at.toUtc(), title: title);
  }

  @override
  Future<void> showSummaryAt({
    required int id,
    required int count,
    required DateTime at,
  }) async {
    scheduled[id] = _Scheduled('summary', at.toUtc(), count: count);
  }

  @override
  Future<void> cancelNotification(int id) async {
    scheduled.remove(id);
  }
}

class _TestAuth extends AuthController {
  String? account = 'a';
  int generation = 0;

  @override
  Future<AppUser?> build() async => null;
  @override
  String? get activeAccount => account;
  @override
  int get sessionGeneration => generation;
  @override
  bool sessionIsCurrent(String expected, int expectedGeneration) =>
      account == expected && generation == expectedGeneration;

  void transition(String? next) {
    generation++;
    account = next;
  }
}

class _BlockingSink extends _FakeSink {
  bool blockCancel = false;
  bool blockReminder = false;
  final started = Completer<void>();
  final release = Completer<void>();

  @override
  Future<void> cancelNotification(int id) async {
    if (blockCancel) {
      blockCancel = false;
      started.complete();
      await release.future;
    }
    await super.cancelNotification(id);
  }

  @override
  Future<void> showReminderAt({
    required int id,
    required ReminderKind kind,
    required String title,
    required String body,
    required DateTime at,
  }) async {
    await super.showReminderAt(id: id, kind: kind, title: title, body: body, at: at);
    if (blockReminder) {
      blockReminder = false;
      started.complete();
      await release.future;
    }
  }
}

/// Feature guide G2 (ADR-046): the device scheduler applies the shared
/// policy to every task and calendar reminder. Times are UTC; Cairo is UTC+2
/// in November.
void main() {
  setUpAll(tzdata.initializeTimeZones);

  const cairo = 'Africa/Cairo';
  const quiet = NotificationPreferences(
    quietStartMinute: 22 * 60,
    quietEndMinute: 7 * 60,
  );
  late _FakeSink sink;
  late NotificationScheduler scheduler;
  final now = DateTime.utc(2026, 11, 11, 6);

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    sink = _FakeSink();
    scheduler = NotificationScheduler(sink: sink, clock: () => now);
  });

  Future<void> remind(
    int id,
    DateTime at, {
    NotificationTier tier = NotificationTier.normal,
  }) {
    return scheduler.schedule(
      id: id,
      kind: ReminderKind.task,
      tier: tier,
      title: 'Task reminder',
      body: 'Body $id',
      at: at,
    );
  }

  test('defaults change nothing: reminders and alarms keep their time',
      () async {
    await remind(1, DateTime.utc(2026, 11, 11, 9));
    await remind(
      2,
      DateTime.utc(2026, 11, 11, 21, 30),
      tier: NotificationTier.critical,
    );
    expect(sink.scheduled[1]?.type, 'reminder');
    expect(sink.scheduled[1]?.at, DateTime.utc(2026, 11, 11, 9));
    expect(sink.scheduled[2]?.type, 'alarm');
    expect(sink.scheduled[2]?.at, DateTime.utc(2026, 11, 11, 21, 30));
  });

  test('quiet hours move a reminder to their end in the account zone',
      () async {
    await scheduler.applyPreferences(quiet, cairo);
    await remind(1, DateTime.utc(2026, 11, 11, 21, 30));
    expect(sink.scheduled[1]?.at, DateTime.utc(2026, 11, 12, 5));
  });

  test('alarms wait for quiet hours unless the user allows them', () async {
    await scheduler.applyPreferences(quiet, cairo);
    await remind(
      1,
      DateTime.utc(2026, 11, 11, 21, 30),
      tier: NotificationTier.critical,
    );
    expect(sink.scheduled[1]?.at, DateTime.utc(2026, 11, 12, 5));
    await scheduler.applyPreferences(
      quiet.copyWith(criticalBreaksQuiet: true),
      cairo,
    );
    expect(sink.scheduled[1]?.type, 'alarm');
    expect(sink.scheduled[1]?.at, DateTime.utc(2026, 11, 11, 21, 30));
  });

  test('over the daily limit, reminders share one summary', () async {
    await scheduler.applyPreferences(
      const NotificationPreferences(dailyCap: 2),
      cairo,
    );
    for (var i = 0; i < 4; i++) {
      await remind(10 + i, DateTime.utc(2026, 11, 11, 8 + i));
    }
    final summaryId = summaryNotificationId('2026-11-11');
    final individual = sink.scheduled.keys.where((id) => id != summaryId);
    expect(individual.toList(), [10, 11]);
    expect(sink.scheduled[summaryId]?.type, 'summary');
    expect(sink.scheduled[summaryId]?.count, 2);
    expect(sink.scheduled[summaryId]?.at, DateTime.utc(2026, 11, 11, 10));

    await scheduler.cancel(12);
    expect(sink.scheduled[summaryId]?.count, 1);
    expect(sink.scheduled[summaryId]?.at, DateTime.utc(2026, 11, 11, 11));
    await scheduler.cancel(13);
    expect(sink.scheduled.containsKey(summaryId), isFalse);
  });

  test('alarms are never limited or summarized', () async {
    await scheduler.applyPreferences(
      const NotificationPreferences(dailyCap: 1),
      cairo,
    );
    await remind(1, DateTime.utc(2026, 11, 11, 8));
    await remind(
      2,
      DateTime.utc(2026, 11, 11, 9),
      tier: NotificationTier.critical,
    );
    expect(sink.scheduled[2]?.type, 'alarm');
    final summaryId = summaryNotificationId('2026-11-11');
    expect(sink.scheduled.containsKey(summaryId), isFalse);
  });

  test('turning notifications off cancels everything; on restores it',
      () async {
    await remind(1, DateTime.utc(2026, 11, 11, 9));
    await remind(
      2,
      DateTime.utc(2026, 11, 11, 10),
      tier: NotificationTier.critical,
    );
    await scheduler.applyPreferences(
      const NotificationPreferences(notificationsEnabled: false),
      cairo,
    );
    expect(sink.scheduled, isEmpty);
    await remind(3, DateTime.utc(2026, 11, 11, 11));
    expect(sink.scheduled, isEmpty);

    await scheduler.applyPreferences(NotificationPreferences.defaults, cairo);
    expect(sink.scheduled[1]?.title, 'Task reminder');
    expect(sink.scheduled[2]?.type, 'alarm');
    expect(sink.scheduled[3]?.at, DateTime.utc(2026, 11, 11, 11));
  });

  test('changing settings re-plans reminders scheduled earlier', () async {
    await remind(1, DateTime.utc(2026, 11, 11, 21, 30));
    expect(sink.scheduled[1]?.at, DateTime.utc(2026, 11, 11, 21, 30));
    await scheduler.applyPreferences(quiet, cairo);
    expect(sink.scheduled[1]?.at, DateTime.utc(2026, 11, 12, 5));
    await scheduler.applyPreferences(NotificationPreferences.defaults, cairo);
    expect(sink.scheduled[1]?.at, DateTime.utc(2026, 11, 11, 21, 30));
  });

  test('a time that has passed is not scheduled; the same id is replaced',
      () async {
    await remind(1, DateTime.utc(2026, 11, 11, 5));
    expect(sink.scheduled, isEmpty);
    await remind(2, DateTime.utc(2026, 11, 11, 9));
    await remind(2, DateTime.utc(2026, 11, 11, 12));
    expect(sink.scheduled.length, 1);
    expect(sink.scheduled[2]?.at, DateTime.utc(2026, 11, 11, 12));
  });

  test('the plan survives a restart, and sign-out clears it', () async {
    await scheduler.applyPreferences(quiet, cairo);
    await remind(1, DateTime.utc(2026, 11, 11, 21, 30));
    sink.scheduled.clear();

    final restarted = NotificationScheduler(sink: sink, clock: () => now);
    await restarted.applyPreferences(NotificationPreferences.defaults, cairo);
    expect(sink.scheduled[1]?.at, DateTime.utc(2026, 11, 11, 21, 30));

    await restarted.clear();
    expect(sink.scheduled, isEmpty);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(NotificationScheduler.storageKey), isNull);
  });
  test('queued A operation fails closed after A to B to A', () async {
    final container = ProviderContainer(overrides: [
      authProvider.overrideWith(_TestAuth.new),
    ]);
    addTearDown(container.dispose);
    final auth = container.read(authProvider.notifier) as _TestAuth;
    final a = auth.captureSession()!;
    final blocked = _BlockingSink()..blockCancel = true;
    final guarded = NotificationScheduler(sink: blocked, clock: () => now);
    final first = guarded.schedule(id: 10, kind: ReminderKind.task,
        tier: NotificationTier.normal, title: 'existing', body: 'existing',
        at: DateTime.utc(2026, 11, 11, 9));
    await blocked.started.future;
    final stale = guarded.scheduleForSession(session: a, id: 11,
        kind: ReminderKind.task, tier: NotificationTier.normal,
        title: 'A title', body: 'A private', at: DateTime.utc(2026, 11, 11, 10));
    final rejected = expectLater(stale, throwsStateError);
    auth.transition('b');
    auth.transition('a');
    blocked.release.complete();
    await first;
    await rejected;
    expect(blocked.scheduled.containsKey(11), isFalse);
    final raw = (await SharedPreferences.getInstance())
        .getString(NotificationScheduler.storageKey) ?? '';
    expect(raw, isNot(contains('A private')));
    final current = auth.captureSession()!;
    await guarded.scheduleForSession(session: current, id: 12,
        kind: ReminderKind.task, tier: NotificationTier.normal,
        title: 'current', body: 'current', at: DateTime.utc(2026, 11, 11, 11));
    expect(blocked.scheduled[12]?.title, 'current');
  });

  test('logout during awaited cancellation prevents later scheduling and save', () async {
    final container = ProviderContainer(overrides: [authProvider.overrideWith(_TestAuth.new)]);
    addTearDown(container.dispose);
    final auth = container.read(authProvider.notifier) as _TestAuth;
    final blocked = _BlockingSink()..blockCancel = true;
    final guarded = NotificationScheduler(sink: blocked, clock: () => now);
    final pending = guarded.scheduleForSession(session: auth.captureSession()!, id: 13,
        kind: ReminderKind.task, tier: NotificationTier.normal,
        title: 'A title', body: 'A private', at: DateTime.utc(2026, 11, 11, 10));
    final rejected = expectLater(pending, throwsStateError);
    await blocked.started.future;
    auth.transition(null);
    blocked.release.complete();
    await rejected;
    expect(blocked.scheduled.containsKey(13), isFalse);
    expect((await SharedPreferences.getInstance())
        .getString(NotificationScheduler.storageKey), isNull);
  });

  test('already submitted OS request cannot be cancelled but stale plan is not saved', () async {
    final container = ProviderContainer(overrides: [authProvider.overrideWith(_TestAuth.new)]);
    addTearDown(container.dispose);
    final auth = container.read(authProvider.notifier) as _TestAuth;
    final blocked = _BlockingSink()..blockReminder = true;
    final guarded = NotificationScheduler(sink: blocked, clock: () => now);
    final pending = guarded.scheduleForSession(session: auth.captureSession()!, id: 14,
        kind: ReminderKind.task, tier: NotificationTier.normal,
        title: 'A title', body: 'A private', at: DateTime.utc(2026, 11, 11, 10));
    final rejected = expectLater(pending, throwsStateError);
    await blocked.started.future;
    expect(blocked.scheduled[14]?.title, 'A title'); // already submitted
    auth.transition('b');
    blocked.release.complete();
    await rejected;
    expect((await SharedPreferences.getInstance())
        .getString(NotificationScheduler.storageKey), isNull);
  });

}
