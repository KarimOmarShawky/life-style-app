import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/features/analytics/data/analytics_models.dart';

void main() {
  test('parses real analytics, preserving null (unavailable) rates', () {
    final summary = AnalyticsSummary.fromJson(<String, dynamic>{
      'rangeDays': 7,
      'from': '2026-11-01',
      'to': '2026-11-07',
      'timezone': 'UTC',
      'tasks': <String, dynamic>{
        'completedInRange': 3,
        'createdInRange': 4,
        'pendingNow': 2,
        'overdueNow': 1,
        'completionRatePercent': 75.0,
      },
      'habits': <String, dynamic>{
        'activeHabits': 2,
        'checkinsDoneInRange': 9,
        'consistencyPercent': null,
      },
      'focus': <String, dynamic>{'sessionsInRange': 5, 'totalMinutes': 125.5},
      'goals': <String, dynamic>{
        'active': 1,
        'achievedTotal': 0,
        'achievedInRange': 0,
        'averageNumericProgressPercent': 50,
      },
      'subscriptions': <String, dynamic>{'active': 1, 'dueNext7Days': 1},
      'series': <Map<String, dynamic>>[
        <String, dynamic>{
          'date': '2026-11-07',
          'tasksCompleted': 3,
          'habitCheckins': 2,
          'focusMinutes': 40,
        },
      ],
    });

    expect(summary.tasksCompleted, 3);
    expect(summary.taskCompletionRatePercent, 75.0);
    // Unavailable must stay unavailable, never a fabricated 0%.
    expect(summary.habitConsistencyPercent, isNull);
    expect(summary.goalProgressPercent, 50.0);
    expect(summary.isEmpty, isFalse);
    expect(summary.series.single.tasksCompleted, 3);
  });

  test('aiAggregates sends numbers only and omits unavailable rates', () {
    const summary = AnalyticsSummary(
      rangeDays: 30,
      from: '2026-10-08',
      to: '2026-11-06',
      tasksCompleted: 0,
      tasksCreated: 0,
      tasksPending: 0,
      tasksOverdue: 0,
      taskCompletionRatePercent: null,
      activeHabits: 0,
      habitCheckinsDone: 0,
      habitConsistencyPercent: null,
      focusSessions: 0,
      focusMinutes: 0,
      goalsActive: 0,
      goalsAchievedTotal: 0,
      goalsAchievedInRange: 0,
      goalProgressPercent: null,
      subscriptionsActive: 0,
      subscriptionsDueNext7Days: 0,
      series: [],
    );

    expect(summary.isEmpty, isTrue);
    final payload = summary.aiAggregates();
    expect(payload.containsKey('taskCompletionRatePercent'), isFalse);
    expect(payload.containsKey('habitConsistencyPercent'), isFalse);
    expect(payload.values.every((value) => value is num), isTrue);
  });
}
