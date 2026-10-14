import 'focus_shield_models.dart';
import 'package:lifestyle_mobile/features/tasks/data/task_model.dart';
import 'package:lifestyle_mobile/features/timer/data/timer_session_model.dart';

String tomorrowDateKey(DateTime now) {
  final local = now.toLocal();
  return localDateKey(DateTime(local.year, local.month, local.day + 1));
}

bool rolloverByDefault(Task task, DateTime now) =>
    !task.isDone &&
    task.status != 'cancelled' &&
    task.recurringTaskId == null &&
    task.dueDate != null &&
    task.dueDate!.compareTo(localDateKey(now)) <= 0;

class WeeklyMetrics {
  const WeeklyMetrics(
      {required this.from,
      required this.to,
      this.tasksCompleted,
      this.tasksPending,
      this.habitsDue,
      this.habitsDone,
      this.activeStreaks,
      required this.focusSeconds,
      required this.sessionCount,
      required this.attempts,
      this.averageClarity,
      this.netSpending,
      this.currency,
      this.localFocusOnly = false});
  final DateTime from;
  final DateTime to;
  final int? tasksCompleted;
  final int? tasksPending;
  final int? habitsDue;
  final int? habitsDone;
  final int? activeStreaks;
  final int focusSeconds;
  final int sessionCount;
  final int attempts;
  final double? averageClarity;
  final double? netSpending;
  final String? currency;
  final bool localFocusOnly;
  double? get habitRate => habitsDue == null || habitsDue == 0
      ? null
      : 100 * (habitsDone ?? 0) / habitsDue!;
  int get estimatedMinutesSaved => attempts * estimatedMinutesSavedPerAttempt;
  Map<String, num> aggregates({bool includeSpending = false}) => {
        if (tasksCompleted != null) 'tasksCompleted': tasksCompleted!,
        if (tasksPending != null) 'tasksPending': tasksPending!,
        if (habitRate != null) 'habitConsistencyPercent': habitRate!,
        if (activeStreaks != null) 'activeStreaks': activeStreaks!,
        'focusMinutes': focusSeconds / 60,
        'focusSessions': sessionCount,
        'blockedAttempts': attempts,
        if (averageClarity != null) 'averageClarity': averageClarity!,
        if (includeSpending && netSpending != null) 'netSpending': netSpending!,
      };
  String report() =>
      '''Weekly Brain Report · ${localDateKey(from)} — ${localDateKey(to.subtract(const Duration(microseconds: 1)))}
Tasks completed: ${tasksCompleted ?? 'No data'} · Pending due in window: ${tasksPending ?? 'No data'}
Habit consistency: ${habitRate?.toStringAsFixed(1) ?? 'No data'}${habitRate == null ? '' : '%'} · Check-ins: ${habitsDone ?? 'No data'}/${habitsDue ?? 'No data'} · Active streaks: ${activeStreaks ?? 'No data'}
Focus: ${(focusSeconds / 60).toStringAsFixed(1)} minutes · $sessionCount sessions${localFocusOnly ? ' (local history only)' : ''}
Blocked distraction attempts: $attempts
Brain Clarity Score: ${averageClarity?.toStringAsFixed(1) ?? 'No data'}
Estimated time saved: $estimatedMinutesSaved minutes (estimate: $estimatedMinutesSavedPerAttempt minutes per blocked attempt, not measured)
Net spending (expense − income): ${netSpending?.toStringAsFixed(2) ?? 'No data'} ${currency ?? ''}''';
  String offlineSummary() => '''Offline coaching · No data sent to AI.
${sessionCount == 0 ? 'Start with one 25-minute focus session.' : 'Protect a daily focus block; you tracked $sessionCount sessions this week.'}
${(tasksPending ?? 0) > 3 ? 'Choose three priorities rather than carrying the whole backlog.' : 'Pick one meaningful task to finish tomorrow.'}
${(habitRate ?? 100) < 70 ? 'Make the least consistent habit smaller and easier to start.' : 'Keep your habit cue consistent.'}
${attempts > 0 ? 'Review your triggers and keep distracting apps blocked during focus.' : 'Maintain a calm environment and take deliberate breaks.'}''';
}

WeeklyMetrics calculateWeeklyMetrics(
    {required DateTime now,
    required List<FocusSessionRecord> history,
    List<TimerSession>? backendSessions,
    List<Task>? tasks,
    int? habitsDue,
    int? habitsDone,
    int? activeStreaks,
    double? netSpending,
    String? currency}) {
  final local = now.toLocal();
  final from = DateTime(local.year, local.month, local.day - 6);
  final to = DateTime(local.year, local.month, local.day + 1);
  bool contains(DateTime date) => !date.isBefore(from) && date.isBefore(to);
  final sessions = history.where((s) => contains(s.endedAt)).toList();
  final backend = (backendSessions ?? <TimerSession>[])
      .where((s) => s.endedAt != null && contains(s.endedAt!))
      .toList();
  final backendIds = backend.map((s) => s.id).toSet();
  final localOnly =
      sessions.where((s) => !backendIds.contains(s.backendSessionId)).toList();
  final attempts = sessions.fold<int>(0, (sum, s) => sum + s.attempts);
  return WeeklyMetrics(
      from: from,
      to: to,
      tasksCompleted: tasks
          ?.where((t) =>
              t.isDone && t.completedAt != null && contains(t.completedAt!))
          .length,
      tasksPending: tasks
          ?.where((t) =>
              !t.isDone &&
              t.status != 'cancelled' &&
              t.dueDate != null &&
              t.dueDate!.compareTo(localDateKey(from)) >= 0 &&
              t.dueDate!.compareTo(localDateKey(to)) < 0)
          .length,
      habitsDue: habitsDue,
      habitsDone: habitsDone,
      activeStreaks: activeStreaks,
      focusSeconds: backend.fold<int>(0, (sum, s) => sum + s.durationSeconds) +
          localOnly.fold<int>(0, (sum, s) => sum + s.durationSeconds),
      sessionCount: backend.length + localOnly.length,
      attempts: attempts,
      averageClarity: sessions.isEmpty
          ? null
          : sessions.fold<int>(0, (sum, s) => sum + s.clarityScore) /
              sessions.length,
      netSpending: netSpending,
      currency: currency,
      localFocusOnly: backendSessions == null);
}
