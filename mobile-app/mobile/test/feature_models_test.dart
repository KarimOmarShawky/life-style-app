import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lifestyle_mobile/core/time/api_time.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/paged_list.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'package:lifestyle_mobile/features/calendar/data/calendar_event_model.dart';
import 'package:lifestyle_mobile/features/goals/data/goal_model.dart';
import 'package:lifestyle_mobile/features/projects/data/project_model.dart';
import 'package:lifestyle_mobile/features/recurring/data/recurring_task_model.dart';
import 'package:lifestyle_mobile/features/timer/data/timer_session_model.dart';

class _NoTokenStore implements TokenStore {
  @override
  Future<void> clear() async {}

  @override
  Future<SessionTokens?> read() async => null;

  @override
  Future<void> write(SessionTokens tokens) async {}
}

void main() {
  test('parses a milestone goal with its milestones', () {
    final goal = Goal.fromJson({
      'id': 'goal-1',
      'userId': 'user-1',
      'title': 'Read 12 books',
      'description': null,
      'status': 'active',
      'progressType': 'milestones',
      'targetValue': null,
      'currentValue': null,
      'unit': null,
      'progressPercentage': 50,
      'totalMilestones': 2,
      'completedMilestones': 1,
      'milestones': [
        {
          'id': 'm-1',
          'goalId': 'goal-1',
          'title': 'First four',
          'dueDate': '2026-11-01',
          'completed': true,
          'completedAt': '2026-10-01T10:00:00.000Z',
          'sortOrder': 0,
          'version': 1,
          'createdAt': '2026-10-01T10:00:00.000Z',
          'updatedAt': '2026-10-01T10:00:00.000Z',
        },
        {
          'id': 'm-2',
          'goalId': 'goal-1',
          'title': 'Next four',
          'dueDate': null,
          'completed': false,
          'completedAt': null,
          'sortOrder': 1,
          'version': 1,
          'createdAt': '2026-10-01T10:00:00.000Z',
          'updatedAt': '2026-10-01T10:00:00.000Z',
        },
      ],
      'startDate': null,
      'targetDate': '2026-12-31',
      'achievedAt': null,
      'version': 3,
      'createdAt': '2026-10-01T10:00:00.000Z',
      'updatedAt': '2026-10-01T10:00:00.000Z',
      'deletedAt': null,
    });

    expect(goal.isMilestoneGoal, isTrue);
    expect(goal.progressPercentage, 50.0);
    expect(goal.milestones.length, 2);
    expect(goal.milestones.first.completed, isTrue);
    expect(goal.milestones.last.dueDate, isNull);
    expect(goal.targetDate, DateTime(2026, 12, 31));
    expect(goal.version, 3);
  });

  test('parses project task counts and a date-only due date', () {
    final project = Project.fromJson({
      'id': 'project-1',
      'name': 'Launch',
      'description': null,
      'status': 'on_hold',
      'color': '#2563EB',
      'goalId': null,
      'dueDate': '2026-11-30',
      'createdAt': '2026-10-01T10:00:00.000Z',
      'updatedAt': '2026-10-01T10:00:00.000Z',
      'version': 2,
      'taskCounts': {'open': 3, 'done': 4},
    });

    expect(project.status, 'on_hold');
    expect(project.openTasks, 3);
    expect(project.doneTasks, 4);
    expect(project.dueDate, DateTime(2026, 11, 30));
  });

  test('parses a weekly recurring task with its recurrence rule', () {
    final task = RecurringTask.fromJson({
      'id': 'recurring-1',
      'title': 'Gym',
      'description': null,
      'projectId': null,
      'priority': 'high',
      'estimateMinutes': 60,
      'dueTime': '07:30',
      'reminderOffsetMinutes': 15,
      'status': 'active',
      'generatedThrough': null,
      'createdAt': '2026-10-01T10:00:00.000Z',
      'updatedAt': '2026-10-01T10:00:00.000Z',
      'version': 1,
      'recurrence': {
        'id': 'rule-1',
        'freq': 'weekly',
        'interval': 1,
        'byWeekday': [1, 3],
        'byMonthDay': null,
        'byMonth': null,
        'startDate': '2026-10-05',
        'endDate': null,
        'occurrenceLimit': null,
      },
    });

    expect(task.priority, 'high');
    expect(task.dueTime, '07:30');
    expect(task.recurrence.freq, 'weekly');
    expect(task.recurrence.byWeekday, [1, 3]);
    expect(task.recurrence.startDate, DateTime(2026, 10, 5));
    expect(task.recurrence.endDate, isNull);
  });

  test('parses an event with a reminder', () {
    final event = CalendarEvent.fromJson({
      'id': 'event-1',
      'userId': 'user-1',
      'title': 'Dentist',
      'description': null,
      'location': 'Giza',
      'startAt': '2026-10-08T09:00:00.000Z',
      'endAt': '2026-10-08T10:00:00.000Z',
      'allDay': false,
      'timezone': 'Africa/Cairo',
      'version': 1,
      'createdAt': '2026-10-01T10:00:00.000Z',
      'updatedAt': '2026-10-01T10:00:00.000Z',
      'deletedAt': null,
    });

    expect(event.title, 'Dentist');
    expect(event.location, 'Giza');
    expect(event.allDay, isFalse);
    expect(event.startAt.toUtc(), DateTime.utc(2026, 10, 8, 9));
    expect(event.endAt.toUtc(), DateTime.utc(2026, 10, 8, 10));
  });

  test('marks a session without endedAt as running', () {
    final session = TimerSession.fromJson({
      'id': 'session-1',
      'taskId': 'task-1',
      'startedAt': '2026-10-08T09:00:00.000Z',
      'endedAt': null,
      'mode': 'stopwatch',
      'plannedSeconds': null,
      'durationSeconds': 120,
      'endReason': null,
      'createdAt': '2026-10-08T09:00:00.000Z',
      'updatedAt': '2026-10-08T09:00:00.000Z',
    });

    expect(session.isRunning, isTrue);
    expect(session.durationSeconds, 120);
    expect(session.endReason, isNull);
  });

  test('reads every page of a cursor-paginated list', () async {
    final cursorsSeen = <String?>[];
    final api = ApiClient(
      baseUri: Uri.parse('https://api.example.test/api/v1/'),
      tokenStore: _NoTokenStore(),
      httpClient: MockClient((request) async {
        final cursor = request.url.queryParameters['cursor'];
        cursorsSeen.add(cursor);
        final isFirstPage = cursor == null;
        return http.Response(
          '{"data":[{"id":"item-${isFirstPage ? 1 : 2}"}],'
          '"meta":{"nextCursor":${isFirstPage ? '"next-page"' : 'null'}}}',
          200,
          headers: {'content-type': 'application/json'},
        );
      }),
    );

    final items = await fetchAllPages(api, 'projects');

    expect(items.map((item) => item['id']).toList(), ['item-1', 'item-2']);
    expect(cursorsSeen, [null, 'next-page']);
  });

  test('formats and parses the API date, time and decimal helpers', () {
    expect(formatApiDate(DateTime(2026, 1, 5)), '2026-01-05');
    expect(formatApiTime(const TimeOfDay(hour: 7, minute: 5)), '07:05');
    expect(parseApiTime('23:59'), const TimeOfDay(hour: 23, minute: 59));
    expect(parseApiTime('24:00'), isNull);
    expect(parseApiTime('9'), isNull);
    expect(formatDecimal('12.5000'), '12.5');
    expect(formatDecimal('3.0000'), '3');
    expect(formatDecimal(null), '');
    expect(
      toApiInstant(DateTime.utc(2026, 10, 8, 9)),
      '2026-10-08T09:00:00.000Z',
    );
  });
}
