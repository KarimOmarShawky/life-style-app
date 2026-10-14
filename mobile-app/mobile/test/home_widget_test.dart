import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_models.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_platform.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_provider.dart';
import 'package:lifestyle_mobile/features/focus_shield/home_widget_sync.dart';
import 'package:lifestyle_mobile/features/tasks/data/task_model.dart';
import 'package:lifestyle_mobile/features/tasks/state/tasks_provider.dart';
import 'package:lifestyle_mobile/navigation/deep_link_parser.dart';

Task _task(String id,
        {String title = 'Task',
        String? dueDate,
        String priority = 'medium',
        String status = 'todo'}) =>
    Task(
        id: id,
        title: title,
        dueDate: dueDate,
        status: status,
        priority: priority,
        version: 1);
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('widget exposes only score, XP, level, pending count and one top title',
      () {
    final ledger = XpLedger([
      const XpEvent(
          type: XpType.task, entityId: 't', dateKey: '2026-10-14', xp: 25)
    ]);
    final data = buildHomeWidgetData(
        ledger: ledger,
        history: [],
        now: DateTime(2026, 10, 14),
        tasks: [
          _task('a',
              dueDate: '2026-10-14', title: 'Top priority', priority: 'high'),
          _task('b', dueDate: '2026-10-14', title: 'Never exposed'),
          _task('c', dueDate: '2026-10-14', status: 'done'),
          _task('d', dueDate: '2026-10-15')
        ]);
    expect(data.keys.toSet(),
        {'clarityScore', 'level', 'xp', 'pendingTasksCount', 'topTaskTitle'});
    expect(data['clarityScore'], isNull);
    expect(data['xp'], 25);
    expect(data['level'], 1);
    expect(data['pendingTasksCount'], 2);
    expect(data['topTaskTitle'], 'Top priority');
    expect(data.values, isNot(contains('Never exposed')));
    expect(data,
        isNot(contains('active'))); // Shield status is exclusively native.
  });
  test(
      'today priorities override sorting and unknown task data never becomes zero',
      () {
    final data = buildHomeWidgetData(
        ledger: XpLedger(),
        history: [],
        now: DateTime(2026, 10, 14),
        tasks: [
          _task('a', dueDate: '2026-10-14', priority: 'high'),
          _task('b', title: 'Chosen priority')
        ],
        priorities: ['b']);
    expect(data['topTaskTitle'], 'Chosen priority');
    expect(data['pendingTasksCount'], 2);
    final unknown = buildHomeWidgetData(
        ledger: XpLedger(), history: [], now: DateTime(2026, 10, 14));
    expect(unknown, isNot(contains('pendingTasksCount')));
    expect(unknown, isNot(contains('topTaskTitle')));
  });
  test('widget routes remain explicitly allowlisted and strip extra data', () {
    expect(DeepLinkParser.routeFor('lifestyle://focus?text=private'), '/focus');
    expect(DeepLinkParser.routeFor('lifestyle://daily-plan#private'),
        '/daily-plan');
    expect(DeepLinkParser.routeFor('lifestyle://not-a-route'), '/tasks');
  });
  test('Riverpod pushes updates after both XP and task changes', () async {
    SharedPreferences.setMockInitialValues({});
    final fake = FakeFocusShieldPlatform();
    final today = localDateKey(DateTime.now());
    final source =
        StateProvider<List<Task>>((ref) => [_task('today', dueDate: today)]);
    final container = ProviderContainer(overrides: [
      focusAccountIdProvider.overrideWithValue('widget-test'),
      focusShieldPlatformProvider.overrideWithValue(fake),
      tasksProvider.overrideWith((ref) async => ref.watch(source))
    ]);
    final subscription = container.listen(homeWidgetSyncProvider, (_, __) {});
    addTearDown(() async {
      subscription.close();
      container.dispose();
      await fake.dispose();
    });
    await container.read(focusShieldProvider.future);
    await container.read(tasksProvider.future);
    await Future<void>.delayed(const Duration(milliseconds: 30));
    expect(fake.widgetUpdates.last['pendingTasksCount'], 1);
    await container
        .read(focusShieldProvider.notifier)
        .award(XpType.task, 'today');
    await Future<void>.delayed(const Duration(milliseconds: 30));
    expect(fake.widgetUpdates.last['xp'], 25);
    container.read(source.notifier).state = [];
    await container.read(tasksProvider.future);
    await Future<void>.delayed(const Duration(milliseconds: 30));
    expect(fake.widgetUpdates.last['pendingTasksCount'], 0);
  });
  test('XP writes preserve native Inbox events arriving during disk I/O',
      () async {
    SharedPreferences.setMockInitialValues({});
    final fake = FakeFocusShieldPlatform();
    final container = ProviderContainer(overrides: [
      focusAccountIdProvider.overrideWithValue('racing-widget'),
      focusShieldPlatformProvider.overrideWithValue(fake),
    ]);
    addTearDown(() async {
      container.dispose();
      await fake.dispose();
    });
    await container.read(focusShieldProvider.future);
    final controller = container.read(focusShieldProvider.notifier);
    await controller.setEnabled(true);
    await controller.beginTimer(
        id: 'racing-session', taskTitle: 'Study', seconds: 1500);
    await Future<void>.delayed(Duration.zero);
    final award = controller.award(XpType.task, 'other-task');
    scheduleMicrotask(() => fake.controller.add({
          'schemaVersion': 1,
          'type': 'inbox',
          'sessionId': 'racing-session',
          'key': 'message',
          'packageName': 'com.whatsapp',
          'sender': 'private sender',
          'text': 'private body'
        }));
    await award;
    await Future<void>.delayed(Duration.zero);
    final data = container.read(focusShieldProvider).requireValue;
    expect(data.ledger.totalXp, 25);
    expect(data.inbox['message']?.text, 'private body');
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('focus_suite.v1.racing-widget'),
        isNot(contains('private body')));
  });
}
