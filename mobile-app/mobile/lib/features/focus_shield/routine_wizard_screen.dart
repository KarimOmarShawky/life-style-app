import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lifestyle_mobile/features/tasks/data/task_model.dart';
import 'package:lifestyle_mobile/features/tasks/data/tasks_repository.dart';
import 'package:lifestyle_mobile/features/tasks/state/tasks_provider.dart';
import 'package:lifestyle_mobile/features/more/data/daily_plan_models.dart';
import 'package:lifestyle_mobile/features/notes/state/notes_provider.dart';
import 'focus_shield_models.dart';
import 'focus_shield_provider.dart';
import 'focus_shield_screen.dart';
import 'routine_and_weekly_models.dart';

enum RoutineKind { morning, night }

class RoutineWizardScreen extends ConsumerStatefulWidget {
  const RoutineWizardScreen({super.key});
  @override
  ConsumerState<RoutineWizardScreen> createState() =>
      _RoutineWizardScreenState();
}

class _RoutineWizardScreenState extends ConsumerState<RoutineWizardScreen> {
  RoutineKind _kind = RoutineKind.morning;
  int _step = 0;
  bool _busy = false;
  List<Task>? _tasks;
  DayPlanView? _plan;
  String? _error;
  final _priorities = <String>{};
  final _rollover = <String>{};
  final _quickTask = TextEditingController();
  final _reflection = TextEditingController();
  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _quickTask.dispose();
    _reflection.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action) async {
    if (_busy || !mounted) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (_) {
      if (mounted) {
        setState(() => _error =
            'Could not complete the action. No successful server changes are hidden; retry or use Undo.');
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _load() async {
    try {
      final tasks = await ref.read(tasksRepositoryProvider).listAllTasks();
      final plan = await ref
          .read(dailyPlanRepositoryProvider)
          .getDayPlan(date: localDateKey(DateTime.now()));
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getStringList(
              'routine.${ref.read(focusAccountIdProvider)}.${localDateKey(DateTime.now())}.top3') ??
          [];
      if (!mounted) return;
      setState(() {
        _priorities.removeWhere(
            (id) => !tasks.any((task) => task.id == id && !task.isDone));
        if (_tasks == null) {
          _priorities.addAll(saved.take(3).where(
              (id) => tasks.any((task) => task.id == id && !task.isDone)));
        }
        _tasks = tasks;
        _plan = plan;
        _rollover.clear();
        _rollover.addAll(tasks
            .where((task) => rolloverByDefault(task, DateTime.now()))
            .map((task) => task.id));
      });
    } catch (_) {
      if (mounted) {
        setState(() =>
            _error = 'Daily data is unavailable. Check connection and retry.');
      }
    }
  }

  Future<void> _createTask() => _run(() async {
        if (_quickTask.text.trim().isEmpty) return;
        final task = await ref.read(tasksRepositoryProvider).createTask(
            title: _quickTask.text.trim(),
            dueDate: localDateKey(DateTime.now()));
        _quickTask.clear();
        if (_priorities.length < 3) {
          _priorities.add(task.id);
        }
        ref.invalidate(tasksProvider);
        await _load();
      });
  Future<void> _savePriorities() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(
        'routine.${ref.read(focusAccountIdProvider)}.${localDateKey(DateTime.now())}.top3',
        _priorities.take(3).toList());
  }

  Future<void> _moveTasks() => _run(() async {
        final controller = ref.read(tasksControllerProvider);
        final tomorrow = tomorrowDateKey(DateTime.now());
        final changes = [
          for (final task in _tasks ?? <Task>[])
            if (_rollover.contains(task.id))
              TaskDateChange(task, tomorrow, task.dueTime)
        ];
        final result = await controller.bulkUpdateDueDates(changes);
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            duration: const Duration(seconds: 12),
            content: Text(
                '${result.applied.length} tasks moved. ${result.failedIds.length} failed (not moved).'),
            action: result.applied.isEmpty
                ? null
                : SnackBarAction(
                    label: 'Undo',
                    onPressed: () => _run(() async {
                          final undo = await controller
                              .bulkUpdateDueDates(result.undoChanges);
                          if (!mounted) return;
                          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                              content: Text(
                                  '${undo.applied.length} dates restored. ${undo.failedIds.length} conflicts/failures; newer edits were not overwritten.')));
                          await _load();
                        }))));
        await _load();
      });
  Future<void> _startMorning() => _run(() async {
        await _savePriorities();
        final data = await ref.read(focusShieldProvider.future);
        if (!data.enabled) {
          if (mounted) {
            await Navigator.of(context).push(MaterialPageRoute<void>(
                builder: (_) => const FocusShieldScreen()));
          }
          return;
        }
        final selected = (_tasks ?? <Task>[])
            .where((task) => _priorities.contains(task.id))
            .toList();
        await ref.read(focusShieldProvider.notifier).beginTimer(
            id: 'morning-${DateTime.now().microsecondsSinceEpoch}',
            taskTitle:
                selected.isEmpty ? 'Morning focus' : selected.first.title,
            taskId: selected.isEmpty ? null : selected.first.id,
            seconds: 30 * 60,
            morningDate: localDateKey(DateTime.now()));
        if (mounted) {
          await Navigator.of(context).push(MaterialPageRoute<void>(
              builder: (_) => const FocusShieldScreen()));
        }
      });
  Future<void> _shutdown() => _run(() async {
        if (_reflection.text.trim().isEmpty) {
          setState(() => _error = 'Write a short reflection first.');
          return;
        }
        final day = localDateKey(DateTime.now());
        await ref.read(notesRepositoryProvider).createNote(
            title: 'Night shutdown $day',
            body: _reflection.text,
            tags: const ['daily-reflection']);
        await ref
            .read(focusShieldProvider.notifier)
            .award(XpType.shutdown, 'shutdown', dateKey: day);
        ref.invalidate(notesProvider);
        if (!mounted) return;
        _reflection.clear();
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Reflection saved. +30 XP, at most once per day.')));
      });
  @override
  Widget build(BuildContext context) {
    final tasks = _tasks;
    final focus = ref.watch(focusShieldProvider).asData?.value;
    final today = localDateKey(DateTime.now());
    final scores = focus?.history
            .where((session) => localDateKey(session.endedAt) == today)
            .toList() ??
        [];
    final clarity = scores.isEmpty
        ? 'No data'
        : (scores.fold<int>(0, (sum, s) => sum + s.clarityScore) /
                scores.length)
            .toStringAsFixed(1);
    final unfinished = tasks
            ?.where((task) => !task.isDone && task.status != 'cancelled')
            .toList() ??
        [];
    return Scaffold(
        appBar: AppBar(title: const Text('Daily routines'), actions: [
          IconButton(
              onPressed: _busy ? null : _load, icon: const Icon(Icons.refresh))
        ]),
        body: tasks == null
            ? Center(
                child: _error == null
                    ? const CircularProgressIndicator()
                    : Text(_error!))
            : ListView(children: [
                SegmentedButton<RoutineKind>(
                    segments: const [
                      ButtonSegment(
                          value: RoutineKind.morning,
                          label: Text('Morning Kickoff')),
                      ButtonSegment(
                          value: RoutineKind.night,
                          label: Text('Night Shutdown'))
                    ],
                    selected: {
                      _kind
                    },
                    onSelectionChanged: _busy
                        ? null
                        : (selection) => setState(() {
                              _kind = selection.first;
                              _step = 0;
                            })),
                if (_error != null)
                  Padding(
                      padding: const EdgeInsets.all(16), child: Text(_error!)),
                Stepper(
                    physics: const NeverScrollableScrollPhysics(),
                    currentStep: _step,
                    onStepTapped:
                        _busy ? null : (step) => setState(() => _step = step),
                    onStepContinue: _busy
                        ? null
                        : () => _run(() async {
                              if (_kind == RoutineKind.morning) {
                                await _savePriorities();
                              }
                              if (mounted) {
                                setState(() =>
                                    _step = (_step + 1).clamp(0, 2).toInt());
                              }
                            }),
                    onStepCancel: _step == 0 || _busy
                        ? null
                        : () => setState(() => _step--),
                    steps: _kind == RoutineKind.morning
                        ? [
                            Step(
                                title:
                                    Text('1 · Top 3 (${_priorities.length}/3)'),
                                content: Column(children: [
                                  for (final task in unfinished)
                                    CheckboxListTile(
                                        title: Text(task.title),
                                        value: _priorities.contains(task.id),
                                        onChanged: _busy
                                            ? null
                                            : (value) => setState(() {
                                                  if (value == true &&
                                                      _priorities.length < 3) {
                                                    _priorities.add(task.id);
                                                  } else if (value != true) {
                                                    _priorities.remove(task.id);
                                                  }
                                                })),
                                  TextField(
                                      controller: _quickTask,
                                      decoration: const InputDecoration(
                                          labelText:
                                              'Quick-create a task for today')),
                                  TextButton(
                                      onPressed: _busy ? null : _createTask,
                                      child: const Text('Create task')),
                                ])),
                            Step(
                                title:
                                    const Text('2 · Habits & scheduled events'),
                                content: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      for (final habit in _plan?.habits ??
                                          <DayPlanHabitItem>[])
                                        if (habit.dueOn)
                                          Text(
                                              '${habit.completedOn ? '✓' : '○'} ${habit.name}'),
                                      for (final event in _plan?.events ??
                                          <DayPlanEventItem>[])
                                        Text(
                                            '${event.title} · ${event.startAt}'),
                                      if ((_plan?.habits.isEmpty ?? true) &&
                                          (_plan?.events.isEmpty ?? true))
                                        const Text(
                                            'No habits or events scheduled.'),
                                    ])),
                            Step(
                                title: const Text('3 · Optional focus'),
                                content: Column(children: [
                                  const Text(
                                      'The morning bonus is +30 XP on shield completion, once per local day. Shield is always opt-in.'),
                                  FilledButton(
                                      onPressed: _busy ? null : _startMorning,
                                      child: const Text(
                                          'Start 30-Min Morning Focus Shield')),
                                ])),
                          ]
                        : [
                            Step(
                                title: const Text('1 · Review today'),
                                content: Text(
                                    'Completed due today: ${tasks.where((task) => task.isDone && task.dueDate == today).length}\nUnfinished due today: ${unfinished.where((task) => task.dueDate == today).length}\nBrain Clarity Score: $clarity')),
                            Step(
                                title: const Text('2 · Task rollover preview'),
                                content: Column(children: [
                                  Text(
                                      '${_rollover.length} tasks will move to tomorrow (${tomorrowDateKey(DateTime.now())})'),
                                  const Text(
                                      'Recurring instances and undated tasks are not selected by default. You can explicitly select them. Newer edits are protected by version checks.'),
                                  for (final task in unfinished)
                                    CheckboxListTile(
                                        title: Text(task.title),
                                        subtitle: Text(
                                            '${task.dueDate ?? 'No due date'}${task.recurringTaskId == null ? '' : ' · Recurring instance'}'),
                                        value: _rollover.contains(task.id),
                                        onChanged: _busy
                                            ? null
                                            : (value) => setState(() {
                                                  if (value == true) {
                                                    _rollover.add(task.id);
                                                  } else {
                                                    _rollover.remove(task.id);
                                                  }
                                                })),
                                  FilledButton(
                                      onPressed: _busy || _rollover.isEmpty
                                          ? null
                                          : _moveTasks,
                                      child: const Text(
                                          'Move selected tasks to tomorrow')),
                                ])),
                            Step(
                                title: const Text('3 · Reflection'),
                                content: Column(children: [
                                  TextField(
                                      controller: _reflection,
                                      maxLines: 4,
                                      decoration: const InputDecoration(
                                          labelText:
                                              'What helped your clarity today?')),
                                  FilledButton(
                                      onPressed: _busy ? null : _shutdown,
                                      child: const Text(
                                          'Save reflection · +30 XP'))
                                ])),
                          ]),
              ]));
  }
}
