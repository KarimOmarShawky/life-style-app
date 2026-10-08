import 'package:lifestyle_mobile/data/json_fields.dart';

/// One tracked focus period on a task, as returned by the timer-sessions API.
class TimerSession {
  const TimerSession({
    required this.id,
    required this.taskId,
    required this.startedAt,
    required this.endedAt,
    required this.mode,
    required this.durationSeconds,
    required this.endReason,
  });

  final String id;
  final String taskId;
  final DateTime startedAt;
  final DateTime? endedAt;
  final String mode;
  final int durationSeconds;
  final String? endReason;

  bool get isRunning => endedAt == null;

  factory TimerSession.fromJson(Map<String, dynamic> json) {
    return TimerSession(
      id: jsonString(json, 'id'),
      taskId: jsonString(json, 'taskId'),
      startedAt: jsonDateTime(json, 'startedAt'),
      endedAt: jsonOptionalDateTime(json, 'endedAt'),
      mode: jsonString(json, 'mode'),
      durationSeconds: jsonInt(json, 'durationSeconds'),
      endReason: jsonOptionalString(json, 'endReason'),
    );
  }
}
