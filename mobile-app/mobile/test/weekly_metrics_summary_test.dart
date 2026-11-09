import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lifestyle_mobile/features/focus_shield/routine_and_weekly_models.dart';
import 'package:lifestyle_mobile/features/focus_shield/weekly_review_screen.dart';

void main() {
  testWidgets('weekly metrics are shown as readable cards, not a text dump',
      (tester) async {
    final metrics = WeeklyMetrics(
      from: DateTime(2026, 11, 2),
      to: DateTime(2026, 11, 9),
      tasksCompleted: 4,
      tasksPending: 2,
      habitsDue: 10,
      habitsDone: 7,
      activeStreaks: 3,
      focusSeconds: 25 * 60,
      sessionCount: 1,
      attempts: 2,
      averageClarity: null,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: WeeklyMetricsSummary(metrics: metrics),
          ),
        ),
      ),
    );

    expect(find.text('Tasks completed'), findsOneWidget);
    expect(find.text('4'), findsOneWidget);
    expect(find.text('Habit consistency'), findsOneWidget);
    expect(find.text('70.0%'), findsOneWidget);
    expect(find.text('Check-ins: 7/10'), findsOneWidget);
    expect(find.text('Focus time'), findsOneWidget);
    expect(find.text('25.0 min'), findsOneWidget);
    expect(find.text('Brain Clarity Score'), findsOneWidget);
    expect(find.text('No data'), findsOneWidget);
    expect(find.text('Estimated time saved'), findsOneWidget);
  });
}
