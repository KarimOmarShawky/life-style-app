import 'package:lifestyle_mobile/data/json_fields.dart';

class CalendarReminder {
  const CalendarReminder({
    required this.id,
    required this.channel,
    required this.offsetMinutes,
    required this.remindAt,
    required this.status,
  });

  final String id;
  final String channel;
  final int? offsetMinutes;
  final DateTime remindAt;
  final String status;

  factory CalendarReminder.fromJson(Map<String, dynamic> json) {
    return CalendarReminder(
      id: jsonString(json, 'id'),
      channel: jsonString(json, 'channel'),
      offsetMinutes: jsonOptionalInt(json, 'offsetMinutes'),
      remindAt: jsonDateTime(json, 'remindAt'),
      status: jsonString(json, 'status'),
    );
  }
}

class CalendarEvent {
  const CalendarEvent({
    required this.id,
    required this.title,
    required this.description,
    required this.location,
    required this.startAt,
    required this.endAt,
    required this.allDay,
    required this.timezone,
    required this.version,
    this.reminders = const <CalendarReminder>[],
  });

  final String id;
  final String title;
  final String? description;
  final String? location;
  final DateTime startAt;
  final DateTime endAt;
  final bool allDay;
  final String timezone;
  final int version;

  /// Filled by create, update and get responses. Lists leave it empty.
  final List<CalendarReminder> reminders;

  factory CalendarEvent.fromJson(Map<String, dynamic> json) {
    return CalendarEvent(
      id: jsonString(json, 'id'),
      title: jsonString(json, 'title'),
      description: jsonOptionalString(json, 'description'),
      location: jsonOptionalString(json, 'location'),
      startAt: jsonDateTime(json, 'startAt'),
      endAt: jsonDateTime(json, 'endAt'),
      allDay: jsonBool(json, 'allDay'),
      timezone: jsonString(json, 'timezone'),
      version: jsonInt(json, 'version'),
      reminders: _parseReminders(json['reminders']),
    );
  }
}

List<CalendarReminder> _parseReminders(Object? raw) {
  if (raw is! List<dynamic>) {
    return const <CalendarReminder>[];
  }
  return raw
      .whereType<Map<String, dynamic>>()
      .map(CalendarReminder.fromJson)
      .toList(growable: false);
}
