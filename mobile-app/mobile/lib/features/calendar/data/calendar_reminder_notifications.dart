import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'package:lifestyle_mobile/data/notification_service.dart';
import 'package:lifestyle_mobile/features/calendar/data/calendar_event_model.dart';

/// Local notifications for calendar reminders.
///
/// The backend stores reminders but does not deliver them. These functions schedule each future
/// reminder as a notification on this device. They keep a small registry in SharedPreferences,
/// keyed by event id, so a change can cancel what was scheduled before. Scheduled notifications
/// survive restarts. [rescheduleCalendarReminders] runs at app start to re-register them.
const String _registryKey = 'calendar_reminder_registry.v1';

/// Stable notification id for a reminder: FNV-1a (32-bit), kept in the positive int32 range.
int calendarReminderNotificationId(String reminderId) {
  var hash = 0x811c9dc5;
  for (final unit in reminderId.codeUnits) {
    hash ^= unit;
    hash = (hash * 0x01000193) & 0xffffffff;
  }
  return 0x40000000 | (hash & 0x3fffffff);
}

/// Replaces every notification of [event] with one per reminder that is still in the future.
Future<void> syncCalendarEventReminders({
  required CalendarEvent event,
  required Iterable<CalendarReminder> reminders,
}) async {
  final registry = await _readRegistry();
  final previous = registry[event.id];
  if (previous != null) {
    await _cancelEntry(previous);
  }

  final now = DateTime.now();
  final upcoming = <_ScheduledReminder>[];
  for (final reminder in reminders) {
    if (reminder.remindAt.isAfter(now)) {
      upcoming.add(
        _ScheduledReminder(
          reminderId: reminder.id,
          remindAt: reminder.remindAt,
        ),
      );
    }
  }

  if (upcoming.isEmpty) {
    registry.remove(event.id);
  } else {
    final entry = _RegistryEntry(
      title: event.title,
      startAt: event.startAt,
      reminders: upcoming,
    );
    registry[event.id] = entry;
    await _scheduleEntry(entry);
  }
  await _writeRegistry(registry);
}

/// Cancels every notification of an event that was deleted.
Future<void> removeCalendarEventReminders(String eventId) async {
  final registry = await _readRegistry();
  final entry = registry.remove(eventId);
  if (entry == null) {
    return;
  }
  await _cancelEntry(entry);
  await _writeRegistry(registry);
}

/// Cancels one reminder that was deleted from an event.
Future<void> removeCalendarReminder(String eventId, String reminderId) async {
  final registry = await _readRegistry();
  final entry = registry[eventId];
  if (entry == null) {
    return;
  }
  await NotificationService.instance.cancelAlarm(
    calendarReminderNotificationId(reminderId),
  );
  final remaining = entry.reminders
      .where((item) => item.reminderId != reminderId)
      .toList(growable: false);
  if (remaining.isEmpty) {
    registry.remove(eventId);
  } else {
    registry[eventId] = _RegistryEntry(
      title: entry.title,
      startAt: entry.startAt,
      reminders: remaining,
    );
  }
  await _writeRegistry(registry);
}

/// Called at app start. Re-registers the reminders that are still upcoming and drops the rest.
Future<void> rescheduleCalendarReminders() async {
  final registry = await _readRegistry();
  final now = DateTime.now();
  var changed = false;
  for (final item in registry.entries.toList(growable: false)) {
    final entry = item.value;
    final upcoming = entry.reminders
        .where((reminder) => reminder.remindAt.isAfter(now))
        .toList(growable: false);
    if (upcoming.length != entry.reminders.length) {
      changed = true;
    }
    if (upcoming.isEmpty) {
      registry.remove(item.key);
      continue;
    }
    final updated = _RegistryEntry(
      title: entry.title,
      startAt: entry.startAt,
      reminders: upcoming,
    );
    registry[item.key] = updated;
    await _scheduleEntry(updated);
  }
  if (changed) {
    await _writeRegistry(registry);
  }
}

Future<void> _scheduleEntry(_RegistryEntry entry) async {
  final body = _startsAtText(
    entry.startAt,
    isArabic: NotificationService.isDeviceArabic,
  );
  for (final reminder in entry.reminders) {
    await NotificationService.instance.scheduleCalendarReminder(
      id: calendarReminderNotificationId(reminder.reminderId),
      title: entry.title,
      body: body,
      when: reminder.remindAt,
    );
  }
}

Future<void> _cancelEntry(_RegistryEntry entry) async {
  for (final reminder in entry.reminders) {
    await NotificationService.instance.cancelAlarm(
      calendarReminderNotificationId(reminder.reminderId),
    );
  }
}

String _startsAtText(DateTime startAt, {required bool isArabic}) {
  final local = startAt.toLocal();
  final hour = local.hour.toString().padLeft(2, '0');
  final minute = local.minute.toString().padLeft(2, '0');
  return isArabic ? 'يبدأ الساعة $hour:$minute' : 'Starts at $hour:$minute';
}

Future<Map<String, _RegistryEntry>> _readRegistry() async {
  final prefs = await SharedPreferences.getInstance();
  final raw = prefs.getString(_registryKey);
  final result = <String, _RegistryEntry>{};
  if (raw == null) {
    return result;
  }
  try {
    final decoded = jsonDecode(raw);
    if (decoded is Map<String, dynamic>) {
      decoded.forEach((eventId, value) {
        final entry = _RegistryEntry.fromJson(value);
        if (entry != null) {
          result[eventId] = entry;
        }
      });
    }
  } on FormatException {
    // A damaged registry is ignored. Reminders are fetched again the next time an event is saved.
  }
  return result;
}

Future<void> _writeRegistry(Map<String, _RegistryEntry> registry) async {
  final prefs = await SharedPreferences.getInstance();
  if (registry.isEmpty) {
    await prefs.remove(_registryKey);
    return;
  }
  final encoded = <String, Object>{
    for (final item in registry.entries) item.key: item.value.toJson(),
  };
  await prefs.setString(_registryKey, jsonEncode(encoded));
}

class _ScheduledReminder {
  const _ScheduledReminder({required this.reminderId, required this.remindAt});

  final String reminderId;
  final DateTime remindAt;

  Map<String, Object> toJson() => <String, Object>{
        'id': reminderId,
        'remindAt': remindAt.toUtc().toIso8601String(),
      };

  static _ScheduledReminder? fromJson(Object? raw) {
    if (raw is! Map<String, dynamic>) {
      return null;
    }
    final id = raw['id'];
    final remindAt = raw['remindAt'];
    if (id is! String || remindAt is! String) {
      return null;
    }
    final parsed = DateTime.tryParse(remindAt);
    if (parsed == null) {
      return null;
    }
    return _ScheduledReminder(reminderId: id, remindAt: parsed);
  }
}

class _RegistryEntry {
  const _RegistryEntry({
    required this.title,
    required this.startAt,
    required this.reminders,
  });

  final String title;
  final DateTime startAt;
  final List<_ScheduledReminder> reminders;

  Map<String, Object> toJson() => <String, Object>{
        'title': title,
        'startAt': startAt.toUtc().toIso8601String(),
        'reminders': <Object>[
          for (final reminder in reminders) reminder.toJson(),
        ],
      };

  static _RegistryEntry? fromJson(Object? raw) {
    if (raw is! Map<String, dynamic>) {
      return null;
    }
    final title = raw['title'];
    final startAt = raw['startAt'];
    final reminders = raw['reminders'];
    if (title is! String || startAt is! String || reminders is! List<dynamic>) {
      return null;
    }
    final startTime = DateTime.tryParse(startAt);
    if (startTime == null) {
      return null;
    }
    final items = reminders
        .map(_ScheduledReminder.fromJson)
        .whereType<_ScheduledReminder>()
        .toList(growable: false);
    return _RegistryEntry(title: title, startAt: startTime, reminders: items);
  }
}
