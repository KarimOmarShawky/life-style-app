import 'package:lifestyle_mobile/data/json_fields.dart';

const List<String> recurringStatuses = ['active', 'paused', 'ended'];
const List<String> recurrenceFrequencies = [
  'daily',
  'weekly',
  'monthly',
  'yearly'
];
const List<String> taskPriorities = ['none', 'low', 'medium', 'high'];

/// Recurrence rule as returned by the API. `byWeekday` uses 1 for Monday through 7 for Sunday.
class RecurrenceRule {
  const RecurrenceRule({
    required this.freq,
    required this.interval,
    required this.byWeekday,
    required this.startDate,
    required this.endDate,
  });

  final String freq;
  final int interval;
  final List<int> byWeekday;
  final DateTime? startDate;
  final DateTime? endDate;

  factory RecurrenceRule.fromJson(Map<String, dynamic> json) {
    final rawWeekdays = json['byWeekday'];
    return RecurrenceRule(
      freq: jsonString(json, 'freq'),
      interval: jsonInt(json, 'interval'),
      byWeekday: rawWeekdays is List<dynamic>
          ? rawWeekdays.whereType<int>().toList(growable: false)
          : const <int>[],
      startDate: jsonOptionalDate(json, 'startDate'),
      endDate: jsonOptionalDate(json, 'endDate'),
    );
  }
}

class RecurringTask {
  const RecurringTask({
    required this.id,
    required this.title,
    required this.description,
    required this.projectId,
    required this.priority,
    required this.estimateMinutes,
    required this.dueTime,
    required this.reminderOffsetMinutes,
    required this.status,
    required this.version,
    required this.recurrence,
  });

  final String id;
  final String title;
  final String? description;
  final String? projectId;
  final String priority;
  final int? estimateMinutes;
  final String? dueTime;
  final int? reminderOffsetMinutes;
  final String status;
  final int version;
  final RecurrenceRule recurrence;

  factory RecurringTask.fromJson(Map<String, dynamic> json) {
    return RecurringTask(
      id: jsonString(json, 'id'),
      title: jsonString(json, 'title'),
      description: jsonOptionalString(json, 'description'),
      projectId: jsonOptionalString(json, 'projectId'),
      priority: jsonString(json, 'priority'),
      estimateMinutes: jsonOptionalInt(json, 'estimateMinutes'),
      dueTime: jsonOptionalString(json, 'dueTime'),
      reminderOffsetMinutes: jsonOptionalInt(json, 'reminderOffsetMinutes'),
      status: jsonString(json, 'status'),
      version: jsonInt(json, 'version'),
      recurrence: RecurrenceRule.fromJson(
        jsonObject(json['recurrence'], 'recurrence'),
      ),
    );
  }
}
