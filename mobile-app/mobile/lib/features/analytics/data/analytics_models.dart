import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/core_providers.dart';
import 'package:lifestyle_mobile/data/json_fields.dart';

/// One trend bucket (a day, or a 7-day bucket for long ranges).
class AnalyticsSeriesPoint {
  const AnalyticsSeriesPoint({
    required this.date,
    required this.tasksCompleted,
    required this.habitCheckins,
    required this.focusMinutes,
  });

  final String date;
  final int tasksCompleted;
  final int habitCheckins;
  final double focusMinutes;

  factory AnalyticsSeriesPoint.fromJson(Map<String, dynamic> json) =>
      AnalyticsSeriesPoint(
        date: jsonString(json, 'date'),
        tasksCompleted: jsonOptionalInt(json, 'tasksCompleted') ?? 0,
        habitCheckins: jsonOptionalInt(json, 'habitCheckins') ?? 0,
        focusMinutes: jsonOptionalDouble(json, 'focusMinutes') ?? 0,
      );
}

/// Real analytics aggregated by the backend from the user's own rows.
/// Nullable rates are unavailable (no denominator) — never demo numbers.
class AnalyticsSummary {
  const AnalyticsSummary({
    required this.rangeDays,
    required this.from,
    required this.to,
    required this.tasksCompleted,
    required this.tasksCreated,
    required this.tasksPending,
    required this.tasksOverdue,
    required this.taskCompletionRatePercent,
    required this.activeHabits,
    required this.habitCheckinsDone,
    required this.habitConsistencyPercent,
    required this.focusSessions,
    required this.focusMinutes,
    required this.goalsActive,
    required this.goalsAchievedTotal,
    required this.goalsAchievedInRange,
    required this.goalProgressPercent,
    required this.subscriptionsActive,
    required this.subscriptionsDueNext7Days,
    required this.series,
  });

  final int rangeDays;
  final String from;
  final String to;
  final int tasksCompleted;
  final int tasksCreated;
  final int tasksPending;
  final int tasksOverdue;
  final double? taskCompletionRatePercent;
  final int activeHabits;
  final int habitCheckinsDone;
  final double? habitConsistencyPercent;
  final int focusSessions;
  final double focusMinutes;
  final int goalsActive;
  final int goalsAchievedTotal;
  final int goalsAchievedInRange;
  final double? goalProgressPercent;
  final int subscriptionsActive;
  final int subscriptionsDueNext7Days;
  final List<AnalyticsSeriesPoint> series;

  bool get isEmpty =>
      tasksCreated == 0 &&
      habitCheckinsDone == 0 &&
      focusSessions == 0 &&
      goalsActive == 0 &&
      subscriptionsActive == 0;

  /// Numbers-only payload that may be sent to Gemini after explicit
  /// per-request consent. No titles, notes or personal content.
  Map<String, num> aiAggregates({Map<String, num> streaks = const {}}) {
    return <String, num>{
      'tasksCompleted': tasksCompleted,
      'tasksCreated': tasksCreated,
      'tasksPending': tasksPending,
      'tasksOverdue': tasksOverdue,
      if (taskCompletionRatePercent != null)
        'taskCompletionRatePercent': taskCompletionRatePercent!,
      'activeHabits': activeHabits,
      'habitCheckinsDone': habitCheckinsDone,
      if (habitConsistencyPercent != null)
        'habitConsistencyPercent': habitConsistencyPercent!,
      'focusSessions': focusSessions,
      'focusMinutes': focusMinutes,
      'goalsActive': goalsActive,
      'goalsAchievedInRange': goalsAchievedInRange,
      if (goalProgressPercent != null)
        'goalProgressPercent': goalProgressPercent!,
      ...streaks,
    };
  }

  List<Map<String, dynamic>> aiWeeklyTrends() => series
      .map(
        (point) => <String, dynamic>{
          'date': point.date,
          'tasks': point.tasksCompleted,
          'habits': point.habitCheckins,
          'focusMinutes': point.focusMinutes,
        },
      )
      .toList(growable: false);

  factory AnalyticsSummary.fromJson(Map<String, dynamic> json) {
    final tasks = jsonObject(json['tasks'], 'tasks');
    final habits = jsonObject(json['habits'], 'habits');
    final focus = jsonObject(json['focus'], 'focus');
    final goals = jsonObject(json['goals'], 'goals');
    final subscriptions = jsonObject(json['subscriptions'], 'subscriptions');
    return AnalyticsSummary(
      rangeDays: jsonOptionalInt(json, 'rangeDays') ?? 7,
      from: jsonString(json, 'from'),
      to: jsonString(json, 'to'),
      tasksCompleted: jsonOptionalInt(tasks, 'completedInRange') ?? 0,
      tasksCreated: jsonOptionalInt(tasks, 'createdInRange') ?? 0,
      tasksPending: jsonOptionalInt(tasks, 'pendingNow') ?? 0,
      tasksOverdue: jsonOptionalInt(tasks, 'overdueNow') ?? 0,
      taskCompletionRatePercent:
          jsonOptionalDouble(tasks, 'completionRatePercent'),
      activeHabits: jsonOptionalInt(habits, 'activeHabits') ?? 0,
      habitCheckinsDone: jsonOptionalInt(habits, 'checkinsDoneInRange') ?? 0,
      habitConsistencyPercent: jsonOptionalDouble(habits, 'consistencyPercent'),
      focusSessions: jsonOptionalInt(focus, 'sessionsInRange') ?? 0,
      focusMinutes: jsonOptionalDouble(focus, 'totalMinutes') ?? 0,
      goalsActive: jsonOptionalInt(goals, 'active') ?? 0,
      goalsAchievedTotal: jsonOptionalInt(goals, 'achievedTotal') ?? 0,
      goalsAchievedInRange: jsonOptionalInt(goals, 'achievedInRange') ?? 0,
      goalProgressPercent:
          jsonOptionalDouble(goals, 'averageNumericProgressPercent'),
      subscriptionsActive: jsonOptionalInt(subscriptions, 'active') ?? 0,
      subscriptionsDueNext7Days:
          jsonOptionalInt(subscriptions, 'dueNext7Days') ?? 0,
      series: jsonObjectList(json['series'], 'series')
          .map(AnalyticsSeriesPoint.fromJson)
          .toList(growable: false),
    );
  }
}

class AnalyticsRepository {
  const AnalyticsRepository(this._api);

  final ApiClient _api;

  Future<AnalyticsSummary> getAnalytics({required int days}) async {
    final response = jsonObject(
      await _api.get('analytics', query: <String, String>{'days': '$days'}),
      'analytics',
    );
    return AnalyticsSummary.fromJson(
      jsonObject(response['analytics'], 'analytics'),
    );
  }
}

final analyticsRepositoryProvider = Provider<AnalyticsRepository>(
  (ref) => AnalyticsRepository(ref.watch(apiClientProvider)),
);
