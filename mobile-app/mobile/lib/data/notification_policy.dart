import 'package:timezone/timezone.dart' as tz;

/// Feature guide G2 (ADR-046): the notification policy.
///
/// The Dart twin of backend/src/features/notifications/notification-policy.ts.
/// Both must pass the shared cases in
/// test/fixtures/notification_policy_cases.json. Every notification gets one
/// outcome: allow, delay (out of quiet hours), digest (joins that local day's
/// summary) or drop (the master switch is off). Pure: no I/O, and it never
/// sees notification text.

/// Critical: an alarm the user chose. Normal: task and calendar reminders.
/// Low: nudges (none exist yet).
enum NotificationTier { critical, normal, low }

class NotificationPreferences {
  const NotificationPreferences({
    this.notificationsEnabled = true,
    this.quietStartMinute,
    this.quietEndMinute,
    this.dailyCap,
    this.digestEnabled = false,
    this.criticalBreaksQuiet = false,
  });

  /// Everything on, no quiet hours, no daily limit (owner decision).
  static const NotificationPreferences defaults = NotificationPreferences();

  /// Suggested when the user turns quiet hours on: 22:00-07:00.
  static const int suggestedQuietStart = 22 * 60;
  static const int suggestedQuietEnd = 7 * 60;

  static const int maxDailyCap = 50;

  final bool notificationsEnabled;

  /// Local minutes after midnight; start is inclusive, end exclusive.
  final int? quietStartMinute;
  final int? quietEndMinute;

  /// Non-critical notifications per local day before the rest join the
  /// summary, or null for no limit.
  final int? dailyCap;
  final bool digestEnabled;
  final bool criticalBreaksQuiet;

  bool get hasQuietHours =>
      quietStartMinute != null &&
      quietEndMinute != null &&
      quietStartMinute != quietEndMinute;

  NotificationPreferences copyWith({
    bool? notificationsEnabled,
    bool? digestEnabled,
    bool? criticalBreaksQuiet,
  }) {
    return NotificationPreferences(
      notificationsEnabled: notificationsEnabled ?? this.notificationsEnabled,
      quietStartMinute: quietStartMinute,
      quietEndMinute: quietEndMinute,
      dailyCap: dailyCap,
      digestEnabled: digestEnabled ?? this.digestEnabled,
      criticalBreaksQuiet: criticalBreaksQuiet ?? this.criticalBreaksQuiet,
    );
  }

  /// Sets or clears (both null) quiet hours.
  NotificationPreferences withQuietHours(int? start, int? end) {
    final valid = start != null && end != null && start != end;
    return NotificationPreferences(
      notificationsEnabled: notificationsEnabled,
      quietStartMinute: valid ? start : null,
      quietEndMinute: valid ? end : null,
      dailyCap: dailyCap,
      digestEnabled: digestEnabled,
      criticalBreaksQuiet: criticalBreaksQuiet,
    );
  }

  NotificationPreferences withDailyCap(int? cap) {
    final valid = cap != null && cap >= 1 && cap <= maxDailyCap;
    return NotificationPreferences(
      notificationsEnabled: notificationsEnabled,
      quietStartMinute: quietStartMinute,
      quietEndMinute: quietEndMinute,
      dailyCap: valid ? cap : null,
      digestEnabled: digestEnabled,
      criticalBreaksQuiet: criticalBreaksQuiet,
    );
  }

  /// The API body of PUT /notification-preferences.
  Map<String, Object?> toJson() {
    Map<String, String>? quietHours;
    if (hasQuietHours) {
      quietHours = <String, String>{
        'start': formatClockMinute(quietStartMinute!),
        'end': formatClockMinute(quietEndMinute!),
      };
    }
    return <String, Object?>{
      'notificationsEnabled': notificationsEnabled,
      'quietHours': quietHours,
      'dailyLimit': dailyCap,
      'digestEnabled': digestEnabled,
      'criticalBreaksQuiet': criticalBreaksQuiet,
    };
  }

  /// Tolerant parsing: anything malformed falls back to the default.
  factory NotificationPreferences.fromJson(Map<String, Object?> json) {
    final quiet = json['quietHours'];
    int? start;
    int? end;
    if (quiet is Map<Object?, Object?>) {
      final rawStart = quiet['start'];
      final rawEnd = quiet['end'];
      start = rawStart is String ? parseClockMinute(rawStart) : null;
      end = rawEnd is String ? parseClockMinute(rawEnd) : null;
    }
    final base = NotificationPreferences(
      notificationsEnabled: json['notificationsEnabled'] != false,
      digestEnabled: json['digestEnabled'] == true,
      criticalBreaksQuiet: json['criticalBreaksQuiet'] == true,
    );
    final limit = json['dailyLimit'];
    final withQuiet = base.withQuietHours(start, end);
    return withQuiet.withDailyCap(limit is int ? limit : null);
  }

  @override
  bool operator ==(Object other) =>
      other is NotificationPreferences &&
      other.notificationsEnabled == notificationsEnabled &&
      other.quietStartMinute == quietStartMinute &&
      other.quietEndMinute == quietEndMinute &&
      other.dailyCap == dailyCap &&
      other.digestEnabled == digestEnabled &&
      other.criticalBreaksQuiet == criticalBreaksQuiet;

  @override
  int get hashCode => Object.hash(
        notificationsEnabled,
        quietStartMinute,
        quietEndMinute,
        dailyCap,
        digestEnabled,
        criticalBreaksQuiet,
      );
}

sealed class NotificationDecision {
  const NotificationDecision();
}

/// Deliver at [at] (UTC), the intended time.
final class AllowNotification extends NotificationDecision {
  const AllowNotification(this.at);
  final DateTime at;
}

/// Deliver later, at [at] (UTC): the end of quiet hours.
final class DelayNotification extends NotificationDecision {
  const DelayNotification(this.at);
  final DateTime at;
}

/// Join the summary of the local day [localDate] (YYYY-MM-DD).
final class DigestNotification extends NotificationDecision {
  const DigestNotification(this.localDate);
  final String localDate;
}

/// Do not deliver: the master switch is off.
final class DropNotification extends NotificationDecision {
  const DropNotification();
}

NotificationDecision decideNotification({
  required NotificationTier tier,
  required DateTime at,
  required String timeZone,
  required NotificationPreferences preferences,
  required int Function(String localDate) deliveredOn,
}) {
  if (!preferences.notificationsEnabled) return const DropNotification();

  final location = resolveNotificationLocation(timeZone);
  final instant = at.toUtc();
  final quiet = _QuietWindow.of(preferences);
  DateTime? quietEnd;
  if (quiet != null && _isInQuietHours(instant, location, quiet)) {
    quietEnd = _quietEndAfter(instant, location, quiet);
  }

  if (tier == NotificationTier.critical) {
    if (quietEnd != null && !preferences.criticalBreaksQuiet) {
      return DelayNotification(quietEnd);
    }
    return AllowNotification(instant);
  }

  if (tier == NotificationTier.low && preferences.digestEnabled) {
    return DigestNotification(_localDate(instant, location));
  }

  final day = _localDate(quietEnd ?? instant, location);
  final cap = preferences.dailyCap;
  if (cap != null && deliveredOn(day) >= cap) {
    return DigestNotification(day);
  }
  if (quietEnd != null) return DelayNotification(quietEnd);
  return AllowNotification(instant);
}

/// When a local day's summary should arrive: at its first item's time,
/// moved out of quiet hours. The summary is never limited.
DateTime summaryDeliveryAt(
  DateTime firstItemAt,
  String timeZone,
  NotificationPreferences preferences,
) {
  final location = resolveNotificationLocation(timeZone);
  final instant = firstItemAt.toUtc();
  final quiet = _QuietWindow.of(preferences);
  if (quiet == null || !_isInQuietHours(instant, location, quiet)) {
    return instant;
  }
  return _quietEndAfter(instant, location, quiet);
}

/// Parses strict 24-hour "HH:MM" into minutes after midnight.
int? parseClockMinute(String value) {
  final match = RegExp(r'^([01]\d|2[0-3]):([0-5]\d)$').firstMatch(value);
  if (match == null) return null;
  return int.parse(match.group(1)!) * 60 + int.parse(match.group(2)!);
}

/// Formats minutes after midnight as "HH:MM".
String formatClockMinute(int minute) {
  final safe = ((minute % _minutesPerDay) + _minutesPerDay) % _minutesPerDay;
  final hours = (safe ~/ 60).toString().padLeft(2, '0');
  final minutes = (safe % 60).toString().padLeft(2, '0');
  return '$hours:$minutes';
}

/// Local calendar date (YYYY-MM-DD) of [at] in [timeZone].
String localDateOf(DateTime at, String timeZone) =>
    _localDate(at.toUtc(), resolveNotificationLocation(timeZone));

/// The IANA zone, or UTC when it is unknown (same rule as the server).
tz.Location resolveNotificationLocation(String timeZone) {
  try {
    return tz.getLocation(timeZone);
  } catch (_) {
    return tz.UTC;
  }
}

const int _minutesPerDay = 24 * 60;
const int _dayMs = 86400000;

class _QuietWindow {
  const _QuietWindow(this.start, this.end);

  final int start;
  final int end;

  static _QuietWindow? of(NotificationPreferences preferences) {
    if (!preferences.hasQuietHours) return null;
    return _QuietWindow(
      preferences.quietStartMinute!,
      preferences.quietEndMinute!,
    );
  }
}

class _WallClock {
  const _WallClock(this.year, this.month, this.day, this.minuteOfDay);

  final int year;
  final int month;
  final int day;
  final int minuteOfDay;
}

_WallClock _wallClockOf(int instantMs, tz.Location location) {
  final local = tz.TZDateTime.fromMillisecondsSinceEpoch(location, instantMs);
  return _WallClock(
    local.year,
    local.month,
    local.day,
    local.hour * 60 + local.minute,
  );
}

int _offsetAt(int instantMs, tz.Location location) {
  final local = tz.TZDateTime.fromMillisecondsSinceEpoch(location, instantMs);
  return local.timeZoneOffset.inMilliseconds;
}

String _localDate(DateTime instant, tz.Location location) {
  final wall = _wallClockOf(instant.millisecondsSinceEpoch, location);
  final year = wall.year.toString().padLeft(4, '0');
  final month = wall.month.toString().padLeft(2, '0');
  final day = wall.day.toString().padLeft(2, '0');
  return '$year-$month-$day';
}

bool _isInQuietHours(
  DateTime instant,
  tz.Location location,
  _QuietWindow quiet,
) {
  final wall = _wallClockOf(instant.millisecondsSinceEpoch, location);
  final minute = wall.minuteOfDay;
  if (quiet.start < quiet.end) {
    return minute >= quiet.start && minute < quiet.end;
  }
  return minute >= quiet.start || minute < quiet.end;
}

/// The first instant after [instant] whose local wall clock reads the quiet
/// end. An end inside a daylight-saving gap moves forward by the gap; in a
/// repeated hour, the first occurrence after [instant] wins.
DateTime _quietEndAfter(
  DateTime instant,
  tz.Location location,
  _QuietWindow quiet,
) {
  final atMs = instant.millisecondsSinceEpoch;
  final from = _wallClockOf(atMs, location);
  for (var days = 0; days <= 2; days++) {
    final date = DateTime.utc(from.year, from.month, from.day + days);
    final candidates = _instantsForWallClock(
      date.year,
      date.month,
      date.day,
      quiet.end,
      location,
    );
    for (final candidate in candidates) {
      if (candidate > atMs) {
        return DateTime.fromMillisecondsSinceEpoch(candidate, isUtc: true);
      }
    }
  }
  return instant;
}

/// Instants (ascending) whose wall clock in [location] reads the local date
/// and minute. A wall time inside a gap keeps the earlier offset.
List<int> _instantsForWallClock(
  int year,
  int month,
  int day,
  int minuteOfDay,
  tz.Location location,
) {
  final wallTime = DateTime.utc(year, month, day, 0, minuteOfDay);
  final wall = wallTime.millisecondsSinceEpoch;
  final offsetBefore = _offsetAt(wall - _dayMs, location);
  final offsetAfter = _offsetAt(wall + _dayMs, location);
  final valid = <int>[];
  for (final candidate in <int>{wall - offsetBefore, wall - offsetAfter}) {
    if (candidate + _offsetAt(candidate, location) == wall) {
      valid.add(candidate);
    }
  }
  valid.sort();
  if (valid.isNotEmpty) return valid;
  return <int>[wall - offsetBefore];
}
