import 'package:lifestyle_mobile/core/time/api_time.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/json_fields.dart';
import 'package:lifestyle_mobile/features/calendar/data/calendar_event_model.dart';

class CalendarRepository {
  const CalendarRepository(this._api);

  final ApiClient _api;

  /// Events on one calendar day (YYYY-MM-DD), in the user's time zone.
  Future<List<CalendarEvent>> getAgenda(String date) async {
    final response = jsonObject(
      await _api.get('calendar/agenda', query: {'date': date}),
      'agenda',
    );
    return jsonObjectList(
      response['events'],
      'agenda',
    ).map(CalendarEvent.fromJson).toList(growable: false);
  }

  /// Events that overlap the given range. Empty when there is no conflict.
  Future<List<CalendarEvent>> checkConflicts({
    required DateTime start,
    required DateTime end,
    String? excludeEventId,
  }) async {
    final response = jsonObject(
      await _api.get(
        'calendar/conflicts',
        query: {
          'startAt': toApiInstant(start),
          'endAt': toApiInstant(end),
          if (excludeEventId != null) 'excludeEventId': excludeEventId,
        },
      ),
      'conflicts',
    );
    if (!jsonBool(response, 'hasConflict')) return const [];
    return jsonObjectList(
      response['conflicts'],
      'conflicts',
    ).map(CalendarEvent.fromJson).toList(growable: false);
  }

  Future<CalendarEvent> createEvent(Map<String, Object?> fields) async {
    final response = jsonObject(
      await _api.post('calendar', body: fields),
      'event',
    );
    return CalendarEvent.fromJson(jsonObject(response['event'], 'event'));
  }

  /// [changes] may include `version` for optimistic concurrency.
  Future<CalendarEvent> updateEvent(
    String id,
    Map<String, Object?> changes,
  ) async {
    final response = jsonObject(
      await _api.patch('calendar/$id', body: changes),
      'event',
    );
    return CalendarEvent.fromJson(jsonObject(response['event'], 'event'));
  }

  Future<void> deleteEvent(String id) async {
    await _api.delete('calendar/$id');
  }

  Future<List<CalendarReminder>> listReminders(String eventId) async {
    final response = jsonObject(
      await _api.get('calendar/$eventId/reminders'),
      'reminders',
    );
    return jsonObjectList(
      response['reminders'],
      'reminders',
    ).map(CalendarReminder.fromJson).toList(growable: false);
  }

  /// Adds a push reminder that fires [offsetMinutes] before the event starts.
  Future<CalendarReminder> addReminder(String eventId, int offsetMinutes) async {
    final response = jsonObject(
      await _api.post(
        'calendar/$eventId/reminders',
        body: {'channel': 'push', 'offsetMinutes': offsetMinutes},
      ),
      'reminder',
    );
    return CalendarReminder.fromJson(jsonObject(response['reminder'], 'reminder'));
  }

  Future<void> deleteReminder(String eventId, String reminderId) async {
    await _api.delete('calendar/$eventId/reminders/$reminderId');
  }
}
