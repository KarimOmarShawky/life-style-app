import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/session_tokens.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'package:lifestyle_mobile/features/tasks/data/task_model.dart';
import 'package:lifestyle_mobile/features/tasks/data/tasks_repository.dart';
import 'package:lifestyle_mobile/features/tasks/state/tasks_provider.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_models.dart';
import 'package:lifestyle_mobile/features/focus_shield/routine_and_weekly_models.dart';
import 'package:lifestyle_mobile/features/timer/data/timer_session_model.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';

class _NoTokens implements TokenStore {
  @override
  Future<void> clear() async {}
  @override
  Future<SessionTokens?> read() async => null;
  @override
  Future<void> write(SessionTokens tokens) async {}
}

Task _task(String id,
        {String? due = '2026-10-14',
        String? recurring,
        String status = 'todo',
        DateTime? completedAt}) =>
    Task(
        id: id,
        title: 'PRIVATE TASK TITLE',
        status: status,
        priority: 'high',
        version: 1,
        dueDate: due,
        dueTime: due == null ? null : '09:30',
        recurringTaskId: recurring,
        completedAt: completedAt);
FocusSessionRecord _session(String id, DateTime endedAt,
        {int attempts = 0, String? backendId}) =>
    FocusSessionRecord(
        id: id,
        endedAt: endedAt,
        durationSeconds: 1500,
        attempts: attempts,
        shieldCompleted: true,
        manualBypasses: 0,
        completed: true,
        clarityScore: calculateBrainClarityScore(attempts),
        backendSessionId: backendId);
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('tomorrow is a local calendar date across month/year/leap boundaries',
      () {
    expect(tomorrowDateKey(DateTime(2026, 12, 31, 23, 59)), '2027-01-01');
    expect(tomorrowDateKey(DateTime(2028, 2, 28)), '2028-02-29');
    expect(tomorrowDateKey(DateTime(2028, 2, 29)), '2028-03-01');
  });
  test(
      'rollover defaults exclude recurring, undated, future, done and cancelled tasks',
      () {
    final now = DateTime(2026, 10, 14);
    expect(rolloverByDefault(_task('today'), now), isTrue);
    expect(rolloverByDefault(_task('overdue', due: '2026-10-13'), now), isTrue);
    for (final task in [
      _task('rec', recurring: 'template'),
      _task('none', due: null),
      _task('future', due: '2026-10-15'),
      _task('done', status: 'done'),
      _task('cancelled', status: 'cancelled')
    ]) {
      expect(rolloverByDefault(task, now), isFalse);
    }
  });
  test(
      'bulk rollover and Undo retain due times and use fresh optimistic versions',
      () async {
    final bodies = <Map<String, dynamic>>[];
    final api = ApiClient(
        baseUri: Uri.parse('https://api.example/api/v1'),
        tokenStore: _NoTokens(),
        httpClient: MockClient((request) async {
          final body = jsonDecode(request.body) as Map<String, dynamic>;
          bodies.add(body);
          return http.Response(
              jsonEncode({
                'task': {
                  'id': 'task',
                  'title': 'task',
                  'status': 'todo',
                  'priority': 'high',
                  'dueDate': body['dueDate'],
                  'dueTime': body['dueTime'],
                  'version': (body['version'] as int) + 1
                }
              }),
              200);
        }));
    addTearDown(api.close);
    var changed = 0;
    final controller = TasksController(TasksRepository(api), () => changed++);
    final result = await controller.bulkUpdateDueDates(
        [TaskDateChange(_task('task'), '2026-10-15', '09:30')]);
    expect(result.failedIds, isEmpty);
    expect(result.applied.single.after.version, 2);
    final undo = await controller.bulkUpdateDueDates(result.undoChanges);
    expect(undo.failedIds, isEmpty);
    expect(
        bodies[0], {'version': 1, 'dueDate': '2026-10-15', 'dueTime': '09:30'});
    expect(
        bodies[1], {'version': 2, 'dueDate': '2026-10-14', 'dueTime': '09:30'});
    await Future<void>.delayed(Duration.zero);
    expect(changed, 2);
  });
  test('partial failures are visible and Undo never includes unapplied changes',
      () async {
    final api = ApiClient(
        baseUri: Uri.parse('https://api.example/api/v1'),
        tokenStore: _NoTokens(),
        httpClient: MockClient((request) async {
          if (request.url.path.endsWith('/conflict')) {
            return http.Response(
                '{"error":{"code":"VERSION_CONFLICT","message":"Version changed"}}',
                409);
          }
          final body = jsonDecode(request.body) as Map<String, dynamic>;
          return http.Response(
              jsonEncode({
                'task': {
                  'id': 'ok',
                  'title': 'ok',
                  'status': 'todo',
                  'priority': 'high',
                  'dueDate': body['dueDate'],
                  'dueTime': body['dueTime'],
                  'version': 2
                }
              }),
              200);
        }));
    addTearDown(api.close);
    final result = await TasksRepository(api).bulkUpdateDueDates([
      TaskDateChange(_task('ok', due: null), '2026-10-15', null),
      TaskDateChange(_task('conflict'), '2026-10-15', '09:30')
    ]);
    expect(result.failedIds, ['conflict']);
    expect(result.undoChanges.single.task.id, 'ok');
    expect(result.undoChanges.single.dueDate, isNull);
    expect(result.undoChanges.single.dueTime, isNull);
  });
  test(
      'weekly metrics use stored per-session scores and exclude exact end boundary',
      () {
    final now = DateTime(2026, 10, 14);
    final metrics = calculateWeeklyMetrics(
        now: now,
        history: [
          _session('a', DateTime(2026, 10, 8), attempts: 2),
          _session('b', DateTime(2026, 10, 14), attempts: 5),
          _session('old', DateTime(2026, 10, 7, 23, 59), attempts: 9),
          _session('future', DateTime(2026, 10, 15), attempts: 9),
        ],
        tasks: [
          _task('done', status: 'done', completedAt: now),
          _task('pending')
        ],
        habitsDue: 10,
        habitsDone: 7,
        activeStreaks: 2);
    expect(metrics.averageClarity, 65);
    expect(metrics.attempts, 7);
    expect(metrics.estimatedMinutesSaved, 84);
    expect(metrics.tasksCompleted, 1);
    expect(metrics.tasksPending, 1);
    expect(metrics.habitRate, 70);
    expect(metrics.report(), contains('Estimated time saved'));
    expect(metrics.report(), isNot(contains('PRIVATE TASK TITLE')));
  });
  test('weekly focus minutes do not double count local and backend sessions',
      () {
    final now = DateTime(2026, 10, 14, 10);
    final metrics = calculateWeeklyMetrics(now: now, history: [
      _session('local', now, backendId: 'backend')
    ], backendSessions: [
      TimerSession(
          id: 'backend',
          taskId: null,
          startedAt: now.subtract(const Duration(minutes: 25)),
          endedAt: now,
          mode: 'stopwatch',
          durationSeconds: 1500,
          endReason: 'manual')
    ]);
    expect(metrics.sessionCount, 1);
    expect(metrics.focusSeconds, 1500);
  });
  test(
      'no sessions means No data clarity; offline summary is deterministic and private',
      () {
    final metrics = calculateWeeklyMetrics(
        now: DateTime(2026, 10, 14),
        history: [],
        netSpending: 123.45,
        currency: 'EGP');
    expect(metrics.averageClarity, isNull);
    expect(metrics.report(), contains('Brain Clarity Score: No data'));
    expect(metrics.offlineSummary(), metrics.offlineSummary());
    expect(metrics.aggregates(), isNot(contains('netSpending')));
    expect(metrics.aggregates(includeSpending: true)['netSpending'], 123.45);
  });
  test(
      'weekly AI service strips unknown fields and respects BYOK/circuit breaker',
      () async {
    final ai = AiService.instance;
    await ai.setUserApiKey('test-only-weekly-key');
    addTearDown(() => ai.setUserApiKey(null));
    var requests = 0;
    final client = MockClient((request) async {
      requests++;
      expect(request.headers['X-goog-api-key'], 'test-only-weekly-key');
      expect(request.body, contains('focusMinutes'));
      expect(request.body, isNot(contains('PRIVATE_TASK_TITLE')));
      expect(request.body, isNot(contains('packageName')));
      return http.Response(
          '{"candidates":[{"content":{"parts":[{"text":"Coaching"}]}}]}', 200);
    });
    addTearDown(client.close);
    expect(
        await ai.generateWeeklyCoaching(aggregates: {
          'focusMinutes': 30,
          'PRIVATE_TASK_TITLE': 1,
          'packageName': 1
        }, httpClient: client),
        'Coaching');
    await ai.setUserApiKey(null);
    expect(await ai.generateWeeklyCoaching(aggregates: {}, httpClient: client),
        isNull);
    expect(requests, 1);
  });
  test('morning and shutdown bonus keys are daily and idempotent', () {
    var ledger = XpLedger();
    for (var i = 0; i < 3; i++) {
      for (final type in [XpType.morning, XpType.shutdown]) {
        ledger = ledger.award(XpEvent(
            type: type,
            entityId: type.name,
            dateKey: '2026-10-14',
            xp: xpFor(type)));
      }
    }
    expect(ledger.totalXp, 60);
    expect(ledger.events.length, 2);
  });
  test(
      'weekly coach returns offline fallback signal and sends nothing while circuit is paused',
      () async {
    final ai = AiService.instance;
    await ai.setUserApiKey('test-only-bad-weekly-key');
    addTearDown(() => ai.setUserApiKey(null));
    var requests = 0;
    final client = MockClient((_) async {
      requests++;
      return http.Response('{}', 429);
    });
    addTearDown(client.close);
    for (var i = 0; i < 4; i++) {
      expect(
          await ai.generateWeeklyCoaching(
              aggregates: {'focusMinutes': 30}, httpClient: client),
          isNull);
    }
    expect(ai.isKeyPaused, isTrue);
    expect(requests, 3);
  });
}
