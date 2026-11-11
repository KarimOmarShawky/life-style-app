import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'package:lifestyle_mobile/data/notification_policy.dart';
import 'package:lifestyle_mobile/data/notification_service.dart';

/// Which reminder a notification is; it decides the Android channel.
enum ReminderKind { task, calendar }

/// The platform side of [NotificationScheduler]: NotificationService in the
/// app, a fake in tests. Times are absolute instants.
abstract class NotificationSink {
  Future<void> showReminderAt({
    required int id,
    required ReminderKind kind,
    required String title,
    required String body,
    required DateTime at,
  });

  Future<void> showAlarmAt({
    required int id,
    required String title,
    required String body,
    required DateTime at,
  });

  /// One content-free summary notification for [count] reminders.
  Future<void> showSummaryAt({
    required int id,
    required int count,
    required DateTime at,
  });

  Future<void> cancelNotification(int id);
}

/// Feature guide G2 (ADR-046): every task and calendar reminder this app
/// schedules goes through the shared policy here.
///
/// A small plan in SharedPreferences remembers each upcoming reminder (its
/// time, tier and text, like the calendar registry does) so that a change of
/// settings can re-plan all of them, the daily limit can count them, and the
/// reminders over the limit can share one summary. Sign-out clears it.
class NotificationScheduler {
  NotificationScheduler({
    required NotificationSink sink,
    DateTime Function()? clock,
  })  : _sink = sink,
        _clock = clock ?? DateTime.now;

  /// The app-wide scheduler. Tests replace it with one using a fake sink.
  static NotificationScheduler instance = NotificationScheduler(
    sink: const _ServiceSink(),
  );

  static const String storageKey = 'notification_policy.state.v1';

  final NotificationSink _sink;
  final DateTime Function() _clock;

  /// The last queued operation, or null when the scheduler is idle. It is
  /// created lazily and cleared when idle, so no future outlives the zone it
  /// was created in (widget tests run in a fake-async zone).
  Future<void>? _tail;

  /// Schedules or replaces reminder [id]. A time that has passed only
  /// removes what was scheduled before.
  Future<void> schedule({
    required int id,
    required ReminderKind kind,
    required NotificationTier tier,
    required String title,
    required String body,
    required DateTime at,
  }) {
    return _serialized(() async {
      final state = await _load();
      final days = <String?>{};
      final previous = state.entries.remove(id);
      await _sink.cancelNotification(id);
      if (previous != null) days.add(previous.day);
      if (at.isAfter(_clock())) {
        final entry = _Entry(
          id: id,
          kind: kind,
          tier: tier,
          title: title,
          body: body,
          at: at.toUtc(),
        );
        state.entries[id] = entry;
        await _place(state, entry);
        days.add(entry.day);
      }
      await _syncSummaries(state, days);
      await _save(state);
    });
  }

  /// Cancels reminder [id] and updates its day's summary.
  Future<void> cancel(int id) {
    return _serialized(() async {
      final state = await _load();
      final previous = state.entries.remove(id);
      await _sink.cancelNotification(id);
      if (previous != null) {
        await _syncSummaries(state, {previous.day});
      }
      await _save(state);
    });
  }

  /// Stores new settings and re-plans every upcoming reminder.
  Future<void> applyPreferences(
    NotificationPreferences preferences,
    String timeZone,
  ) {
    return _serialized(() async {
      final state = await _load();
      if (state.preferences == preferences && state.timeZone == timeZone) {
        return;
      }
      state.preferences = preferences;
      state.timeZone = timeZone;
      await _replanAll(state);
      await _save(state);
    });
  }

  /// Sign-out: cancels everything this scheduler placed and forgets it.
  Future<void> clear() {
    return _serialized(() async {
      final state = await _load();
      for (final entry in state.entries.values) {
        await _sink.cancelNotification(entry.id);
      }
      for (final day in state.summaries.keys) {
        await _sink.cancelNotification(summaryNotificationId(day));
      }
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(storageKey);
    });
  }

  Future<void> _serialized(Future<void> Function() action) {
    final previous = _tail;
    final run = previous == null ? action() : previous.then((_) => action());
    late final Future<void> tail;
    tail = run.then<void>((_) {}, onError: (Object _) {}).whenComplete(() {
      if (identical(_tail, tail)) _tail = null;
    });
    _tail = tail;
    return run;
  }

  Future<void> _place(_State state, _Entry entry) async {
    entry
      ..outcome = _Outcome.pending
      ..deliverAt = null
      ..day = null
      ..summaryAt = null;
    final decision = decideNotification(
      tier: entry.tier,
      at: entry.at,
      timeZone: state.timeZone,
      preferences: state.preferences,
      deliveredOn: (day) => _deliveredOn(state, day, entry.id),
    );
    if (decision is AllowNotification) {
      await _deliver(state, entry, _Outcome.allow, decision.at);
    } else if (decision is DelayNotification) {
      await _deliver(state, entry, _Outcome.delay, decision.at);
    } else if (decision is DigestNotification) {
      entry
        ..outcome = _Outcome.digest
        ..day = decision.localDate;
    } else {
      entry.outcome = _Outcome.drop;
    }
  }

  Future<void> _deliver(
    _State state,
    _Entry entry,
    _Outcome outcome,
    DateTime decidedAt,
  ) async {
    // A reminder whose time passed while it waited (in quiet hours or in a
    // summary) still arrives, right away, when the settings change.
    final now = _clock();
    final at = decidedAt.isAfter(now) ? decidedAt : now.add(_catchUp);
    entry
      ..outcome = outcome
      ..deliverAt = at.toUtc()
      ..day = localDateOf(at, state.timeZone);
    if (entry.tier == NotificationTier.critical) {
      await _sink.showAlarmAt(
        id: entry.id,
        title: entry.title,
        body: entry.body,
        at: at,
      );
    } else {
      await _sink.showReminderAt(
        id: entry.id,
        kind: entry.kind,
        title: entry.title,
        body: entry.body,
        at: at,
      );
    }
  }

  int _deliveredOn(_State state, String day, int exceptId) {
    var count = 0;
    for (final entry in state.entries.values) {
      if (entry.id == exceptId) continue;
      if (entry.tier == NotificationTier.critical) continue;
      final delivered =
          entry.outcome == _Outcome.allow || entry.outcome == _Outcome.delay;
      if (delivered && entry.day == day) count++;
    }
    return count;
  }

  Future<void> _replanAll(_State state) async {
    final now = _clock();
    final upcoming = <_Entry>[];
    for (final entry in state.entries.values) {
      if (_isUpcoming(entry, now)) upcoming.add(entry);
    }
    upcoming.sort(_byTimeThenId);
    for (final entry in upcoming) {
      await _sink.cancelNotification(entry.id);
      entry.outcome = _Outcome.pending;
    }
    for (final entry in upcoming) {
      await _place(state, entry);
    }
    await _syncSummaries(state, null);
  }

  /// Schedules, moves or cancels the summary of each day in [days] (all days
  /// when null). A summary covers that day's reminders over the limit whose
  /// summary has not been shown yet.
  Future<void> _syncSummaries(_State state, Set<String?>? days) async {
    final now = _clock();
    final open = <String, List<_Entry>>{};
    for (final entry in state.entries.values) {
      final day = entry.day;
      if (entry.outcome != _Outcome.digest || day == null) continue;
      final shownAt = entry.summaryAt;
      if (shownAt != null && !shownAt.isAfter(now)) continue;
      open.putIfAbsent(day, () => <_Entry>[]).add(entry);
    }
    final targets = <String>{
      if (days == null) ...open.keys,
      if (days == null) ...state.summaries.keys,
      if (days != null) ...days.whereType<String>(),
    };
    for (final day in targets) {
      final items = open[day] ?? const <_Entry>[];
      final id = summaryNotificationId(day);
      if (items.isEmpty) {
        final scheduled = state.summaries.remove(day);
        if (scheduled != null && scheduled.isAfter(now)) {
          await _sink.cancelNotification(id);
        }
        continue;
      }
      var first = items.first.at;
      for (final item in items) {
        if (item.at.isBefore(first)) first = item.at;
      }
      var at = summaryDeliveryAt(first, state.timeZone, state.preferences);
      if (!at.isAfter(now)) at = now.add(_catchUp).toUtc();
      for (final item in items) {
        item.summaryAt = at;
      }
      state.summaries[day] = at;
      await _sink.showSummaryAt(id: id, count: items.length, at: at);
    }
  }

  Future<_State> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final state = _State.decode(prefs.getString(storageKey));
    final now = _clock();
    final today = localDateOf(now, state.timeZone);
    // Keep upcoming reminders, and today's delivered ones for the limit.
    state.entries.removeWhere((_, entry) {
      if (_isUpcoming(entry, now)) return false;
      final day = entry.day;
      return day == null || day.compareTo(today) < 0;
    });
    state.summaries.removeWhere((day, _) => day.compareTo(today) < 0);
    return state;
  }

  Future<void> _save(_State state) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(storageKey, jsonEncode(state.toJson()));
  }
}

/// Notification id of a local day's summary. Task ids (String.hashCode)
/// and calendar ids (FNV-1a with bit 30 set) are unlikely to use this range.
int summaryNotificationId(String localDate) {
  final parts = localDate.split('-').map(int.parse).toList();
  final date = DateTime.utc(parts[0], parts[1], parts[2]);
  final days = date.millisecondsSinceEpoch ~/ Duration.millisecondsPerDay;
  return 0x7E000000 | (days & 0xFFFF);
}

const Duration _catchUp = Duration(seconds: 30);

int _byTimeThenId(_Entry a, _Entry b) {
  final byTime = a.at.compareTo(b.at);
  return byTime != 0 ? byTime : a.id.compareTo(b.id);
}

bool _isUpcoming(_Entry entry, DateTime now) {
  switch (entry.outcome) {
    case _Outcome.allow:
    case _Outcome.delay:
      return entry.deliverAt?.isAfter(now) ?? false;
    case _Outcome.digest:
      final shownAt = entry.summaryAt;
      return shownAt == null || shownAt.isAfter(now);
    case _Outcome.pending:
    case _Outcome.drop:
      return entry.at.isAfter(now);
  }
}

enum _Outcome { pending, allow, delay, digest, drop }

class _Entry {
  _Entry({
    required this.id,
    required this.kind,
    required this.tier,
    required this.title,
    required this.body,
    required this.at,
  });

  final int id;
  final ReminderKind kind;
  final NotificationTier tier;
  final String title;
  final String body;

  /// The intended time (UTC).
  final DateTime at;
  _Outcome outcome = _Outcome.pending;
  DateTime? deliverAt;
  String? day;
  DateTime? summaryAt;

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'kind': kind.name,
        'tier': tier.name,
        'title': title,
        'body': body,
        'at': at.toIso8601String(),
        'outcome': outcome.name,
        'deliverAt': deliverAt?.toIso8601String(),
        'day': day,
        'summaryAt': summaryAt?.toIso8601String(),
      };

  static _Entry? fromJson(Object? raw) {
    if (raw is! Map<Object?, Object?>) return null;
    final id = raw['id'];
    final title = raw['title'];
    final body = raw['body'];
    final at = _parseTime(raw['at']);
    if (id is! int || title is! String || body is! String || at == null) {
      return null;
    }
    final kind = _byName(ReminderKind.values, raw['kind']);
    final tier = _byName(NotificationTier.values, raw['tier']);
    final entry = _Entry(
      id: id,
      kind: kind ?? ReminderKind.task,
      tier: tier ?? NotificationTier.normal,
      title: title,
      body: body,
      at: at,
    );
    final day = raw['day'];
    entry
      ..outcome = _byName(_Outcome.values, raw['outcome']) ?? _Outcome.pending
      ..deliverAt = _parseTime(raw['deliverAt'])
      ..day = day is String ? day : null
      ..summaryAt = _parseTime(raw['summaryAt']);
    return entry;
  }
}

class _State {
  _State({
    required this.preferences,
    required this.timeZone,
    required this.entries,
    required this.summaries,
  });

  factory _State.decode(String? raw) {
    final state = _State(
      preferences: NotificationPreferences.defaults,
      timeZone: 'UTC',
      entries: <int, _Entry>{},
      summaries: <String, DateTime>{},
    );
    if (raw == null) return state;
    try {
      final json = jsonDecode(raw);
      if (json is! Map<Object?, Object?>) return state;
      final prefs = json['preferences'];
      if (prefs is Map<Object?, Object?>) {
        state.preferences = NotificationPreferences.fromJson(
          prefs.cast<String, Object?>(),
        );
      }
      final zone = json['timeZone'];
      if (zone is String) state.timeZone = zone;
      final entries = json['entries'];
      if (entries is List<Object?>) {
        for (final item in entries) {
          final entry = _Entry.fromJson(item);
          if (entry != null) state.entries[entry.id] = entry;
        }
      }
      final summaries = json['summaries'];
      if (summaries is Map<Object?, Object?>) {
        for (final item in summaries.entries) {
          final at = _parseTime(item.value);
          if (item.key is String && at != null) {
            state.summaries[item.key as String] = at;
          }
        }
      }
    } on FormatException {
      return state;
    }
    return state;
  }

  NotificationPreferences preferences;
  String timeZone;
  final Map<int, _Entry> entries;
  final Map<String, DateTime> summaries;

  Map<String, Object?> toJson() => <String, Object?>{
        'v': 1,
        'preferences': preferences.toJson(),
        'timeZone': timeZone,
        'entries': [for (final entry in entries.values) entry.toJson()],
        'summaries': {
          for (final item in summaries.entries)
            item.key: item.value.toIso8601String(),
        },
      };
}

DateTime? _parseTime(Object? value) {
  if (value is! String) return null;
  return DateTime.tryParse(value)?.toUtc();
}

T? _byName<T extends Enum>(List<T> values, Object? name) {
  for (final value in values) {
    if (value.name == name) return value;
  }
  return null;
}

/// Production sink: the existing notification channels and their privacy
/// rules (generic titles, private visibility).
class _ServiceSink implements NotificationSink {
  const _ServiceSink();

  @override
  Future<void> showReminderAt({
    required int id,
    required ReminderKind kind,
    required String title,
    required String body,
    required DateTime at,
  }) {
    final service = NotificationService.instance;
    if (kind == ReminderKind.calendar) {
      return service.scheduleCalendarReminder(
        id: id,
        title: title,
        body: body,
        when: at,
      );
    }
    return service.scheduleTaskReminder(
      id: id,
      title: title,
      body: body,
      when: at,
    );
  }

  @override
  Future<void> showAlarmAt({
    required int id,
    required String title,
    required String body,
    required DateTime at,
  }) {
    return NotificationService.instance.scheduleAlarm(
      id: id,
      title: title,
      body: body,
      scheduledDateTime: at,
    );
  }

  @override
  Future<void> showSummaryAt({
    required int id,
    required int count,
    required DateTime at,
  }) {
    return NotificationService.instance.scheduleSummary(
      id: id,
      count: count,
      when: at,
    );
  }

  @override
  Future<void> cancelNotification(int id) {
    return NotificationService.instance.cancelAlarm(id);
  }
}
