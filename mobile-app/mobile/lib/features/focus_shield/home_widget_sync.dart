import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lifestyle_mobile/features/tasks/data/task_model.dart';
import 'package:lifestyle_mobile/features/tasks/state/tasks_provider.dart';
import 'focus_shield_models.dart';
import 'focus_shield_provider.dart';

/// Display whitelist. In particular: no messages, sender, package or notes.
Map<String, Object?> buildHomeWidgetData(
    {required XpLedger ledger,
    required List<FocusSessionRecord> history,
    required DateTime now,
    List<Task>? tasks,
    List<String> priorities = const []}) {
  final orderedHistory = [...history]
    ..sort((a, b) => b.endedAt.compareTo(a.endedAt));
  final today = localDateKey(now);
  final pending = tasks
      ?.where((task) =>
          !task.isDone &&
          task.status != 'cancelled' &&
          (task.dueDate == today || priorities.contains(task.id)))
      .toList();
  if (pending != null) {
    int rank(Task task) {
      final index = priorities.indexOf(task.id);
      return index < 0 ? 3 : index;
    }

    int priority(Task task) => switch (task.priority) {
          'high' => 3,
          'medium' => 2,
          'low' => 1,
          _ => 0
        };
    pending.sort((a, b) {
      final selected = rank(a).compareTo(rank(b));
      return selected != 0 ? selected : priority(b).compareTo(priority(a));
    });
  }
  return {
    'clarityScore':
        orderedHistory.isEmpty ? null : orderedHistory.first.clarityScore,
    'level': ledger.level,
    'xp': ledger.totalXp,
    if (pending != null) 'pendingTasksCount': pending.length,
    if (pending != null)
      'topTaskTitle': pending.isEmpty ? '' : pending.first.title
  };
}

final homeWidgetSyncProvider = Provider.autoDispose<void>((ref) {
  final stats = ref.watch(focusShieldProvider.select((state) {
    final data = state.asData?.value;
    return data == null ? null : (data.ledger, data.history);
  }));
  final tasks = ref.watch(tasksProvider).asData?.value;
  final account = ref.watch(focusAccountIdProvider);
  final platform = ref.read(focusShieldPlatformProvider);
  if (stats == null) return;
  var alive = true;
  final timer = Timer(Duration.zero, () async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (!alive || ref.read(focusAccountIdProvider) != account) return;
      final now = DateTime.now();
      final priorities =
          prefs.getStringList('routine.$account.${localDateKey(now)}.top3') ??
              [];
      await platform.invoke(
          'updateHomeWidget',
          buildHomeWidgetData(
              ledger: stats.$1,
              history: stats.$2,
              tasks: tasks,
              priorities: priorities,
              now: now));
    } catch (_) {
      /* Unsupported platforms/widget errors never break productivity. */
    }
  });
  ref.onDispose(() {
    alive = false;
    timer.cancel();
  });
});
