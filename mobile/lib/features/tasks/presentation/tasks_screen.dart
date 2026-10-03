import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/notification_service.dart';
import 'package:lifestyle_mobile/data/smart_task_parser.dart';
import 'package:lifestyle_mobile/features/home/presentation/widgets/global_search_delegate.dart';
import 'package:lifestyle_mobile/features/tasks/data/task_model.dart';
import 'package:lifestyle_mobile/features/timer/presentation/focus_timer_screen.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';
import 'package:lifestyle_mobile/features/tasks/state/tasks_provider.dart';

class TasksScreen extends ConsumerStatefulWidget {
  const TasksScreen({super.key});

  @override
  ConsumerState<TasksScreen> createState() => _TasksScreenState();
}

class _TasksScreenState extends ConsumerState<TasksScreen> {
  DateTime? _selectedDate;
  final Set<String> _selectedTaskIds = {};
  bool get _isSelectionMode => _selectedTaskIds.isNotEmpty;

  void _toggleTaskSelection(String taskId) {
    setState(() {
      if (_selectedTaskIds.contains(taskId)) {
        _selectedTaskIds.remove(taskId);
      } else {
        _selectedTaskIds.add(taskId);
      }
    });
  }

  void _selectAllTasks(List<Task> tasks) {
    setState(() {
      if (_selectedTaskIds.length == tasks.length) {
        _selectedTaskIds.clear();
      } else {
        _selectedTaskIds.addAll(tasks.map((t) => t.id));
      }
    });
  }

  Future<void> _deleteSelectedTasks(BuildContext context) async {
    final l10n = AppLocalizations.of(context);
    final count = _selectedTaskIds.length;
    if (count == 0) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l10n.deleteSelected),
        content: Text('${l10n.deleteSelectedConfirm} ($count)'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(l10n.deleteSelected),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      final idsToDelete = _selectedTaskIds.toList();
      setState(() => _selectedTaskIds.clear());
      try {
        await ref.read(tasksRepositoryProvider).deleteMultipleTasks(idsToDelete);
        ref.invalidate(tasksProvider);
      } catch (e) {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(_safeMessage(e))),
          );
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final localization = AppLocalizations.of(context);
    final tasksAsync = ref.watch(tasksProvider);

    return Scaffold(
      appBar: _isSelectionMode
          ? AppBar(
              backgroundColor: Theme.of(context).colorScheme.surfaceContainerHighest,
              leading: IconButton(
                icon: const Icon(Icons.close),
                onPressed: () => setState(() => _selectedTaskIds.clear()),
              ),
              title: Text('${_selectedTaskIds.length} ${localization.selectedCount}'),
              actions: [
                IconButton(
                  tooltip: localization.selectAll,
                  icon: const Icon(Icons.select_all),
                  onPressed: () {
                    final tasks = tasksAsync.valueOrNull ?? [];
                    _selectAllTasks(tasks);
                  },
                ),
                IconButton(
                  tooltip: localization.deleteSelected,
                  icon: const Icon(Icons.delete_outline, color: Colors.red),
                  onPressed: () => _deleteSelectedTasks(context),
                ),
              ],
            )
          : AppBar(
              title: Text(localization.tasks),
              actions: [
                IconButton(
                  tooltip: 'بحث شامل',
                  icon: const Icon(Icons.search),
                  onPressed: () {
                    showSearch(
                      context: context,
                      delegate: GlobalSearchDelegate(ref),
                    );
                  },
                ),
                IconButton(
                  tooltip: localization.smartAdd,
                  icon: const Icon(Icons.auto_awesome, color: Colors.amber),
                  onPressed: () => _showSmartQuickAdd(context, ref),
                ),
                IconButton(
                  tooltip: localization.focusTimer,
                  icon: const Icon(Icons.timer_outlined),
                  onPressed: () {
                    Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => const FocusTimerScreen(),
                      ),
                    );
                  },
                ),
                IconButton(
                  tooltip: localization.jumpToDate,
                  icon: const Icon(Icons.calendar_month_outlined),
                  onPressed: () async {
                    final picked = await showDatePicker(
                      context: context,
                      initialDate: _selectedDate ?? DateTime.now(),
                      firstDate: DateTime(2020),
                      lastDate: DateTime(2035),
                    );
                    if (picked != null) {
                      setState(() => _selectedDate = picked);
                    }
                  },
                ),
                IconButton(
                  tooltip: localization.testAlarm,
                  icon: const Icon(Icons.notifications_active_outlined),
                  onPressed: () async {
                    await NotificationService.instance.triggerInstantPersistentAlarm(
                      id: DateTime.now().millisecondsSinceEpoch ~/ 1000,
                      title: '${localization.appTitle}: تذكير بموعد مهم!',
                      body: 'اضغط إيقاف لإيقاف رنين المنبه، أو غفوة للتأجيل',
                    );
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text(localization.testAlarmSent)),
                      );
                    }
                  },
                ),
                IconButton(
                  tooltip: localization.profile,
                  onPressed: () => Navigator.of(context).pushNamed('/profile'),
                  icon: const Icon(Icons.person_outline),
                ),
              ],
            ),
      body: tasksAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => _TaskLoadError(
          message: _safeMessage(error),
          onRetry: () => ref.invalidate(tasksProvider),
        ),
        data: (allItems) {
          final selectedDateStr = _selectedDate == null
              ? null
              : '${_selectedDate!.year}-${_selectedDate!.month.toString().padLeft(2, '0')}-${_selectedDate!.day.toString().padLeft(2, '0')}';

          final displayedItems = selectedDateStr == null
              ? allItems
              : allItems.where((t) => t.dueDate == selectedDateStr).toList();

          return Column(
            children: [
              _buildDateStrip(context, localization, allItems),
              if (_selectedDate == null)
                _buildDailyBriefingCard(context, localization, allItems),
              const Divider(height: 1),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: () async {
                    ref.invalidate(tasksProvider);
                  },
                  child: displayedItems.isEmpty
                      ? ListView(
                          physics: const AlwaysScrollableScrollPhysics(),
                          children: [
                            const SizedBox(height: 100),
                            Icon(
                              _selectedDate == null
                                  ? Icons.check_circle_outline
                                  : Icons.event_available,
                              size: 48,
                              color: Theme.of(context).colorScheme.primary,
                            ),
                            const SizedBox(height: 12),
                            Center(
                              child: Text(
                                _selectedDate == null
                                    ? localization.noTasks
                                    : localization.noTasksForDay,
                                style: const TextStyle(fontSize: 15),
                              ),
                            ),
                            if (_selectedDate != null) ...[
                              const SizedBox(height: 12),
                              Center(
                                child: TextButton.icon(
                                  onPressed: () => _showAddTask(
                                    context,
                                    ref,
                                    initialDate: _selectedDate,
                                  ),
                                  icon: const Icon(Icons.add),
                                  label: Text(localization.addTask),
                                ),
                              ),
                            ],
                          ],
                        )
                      : ListView.separated(
                          physics: const AlwaysScrollableScrollPhysics(),
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          itemCount: displayedItems.length,
                          separatorBuilder: (_, __) =>
                              const Divider(height: 1, indent: 72),
                          itemBuilder: (context, index) {
                            final task = displayedItems[index];
                            return _TaskTile(
                              task: task,
                              isSelectionMode: _isSelectionMode,
                              isSelected: _selectedTaskIds.contains(task.id),
                              onToggleSelect: () => _toggleTaskSelection(task.id),
                              onDelete: () async {
                                await ref
                                    .read(tasksRepositoryProvider)
                                    .deleteTask(task.id);
                                ref.invalidate(tasksProvider);
                              },
                            );
                          },
                        ),
                ),
              ),
            ],
          );
        },
      ),
      floatingActionButton: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          FloatingActionButton.small(
            heroTag: 'voice_mic_btn',
            tooltip: localization.voiceMicPrompt,
            backgroundColor: Theme.of(context).colorScheme.tertiaryContainer,
            onPressed: () =>
                _showSmartQuickAdd(context, ref, initialVoice: true),
            child: Icon(
              Icons.mic,
              color: Theme.of(context).colorScheme.onTertiaryContainer,
            ),
          ),
          const SizedBox(height: 12),
          FloatingActionButton.extended(
            heroTag: 'add_task_btn',
            onPressed: () => _showAddTask(
              context,
              ref,
              initialDate: _selectedDate,
            ),
            icon: const Icon(Icons.add),
            label: Text(localization.addTask),
          ),
        ],
      ),
    );
  }

  Widget _buildDateStrip(
    BuildContext context,
    AppLocalizations localization,
    List<Task> allItems,
  ) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);

    final days = <DateTime>[];
    for (var i = -3; i <= 14; i++) {
      days.add(today.add(Duration(days: i)));
    }

    return Container(
      height: 74,
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        itemCount: days.length + 1,
        itemBuilder: (context, index) {
          if (index == 0) {
            final isAll = _selectedDate == null;
            return Padding(
              padding: const EdgeInsets.only(right: 8),
              child: ChoiceChip(
                label: Text(localization.allTasks),
                selected: isAll,
                onSelected: (_) {
                  setState(() => _selectedDate = null);
                },
              ),
            );
          }

          final day = days[index - 1];
          final isSelected = _selectedDate != null &&
              _selectedDate!.year == day.year &&
              _selectedDate!.month == day.month &&
              _selectedDate!.day == day.day;

          final isToday = day.year == today.year &&
              day.month == today.month &&
              day.day == today.day;

          final dayStr =
              '${day.year}-${day.month.toString().padLeft(2, '0')}-${day.day.toString().padLeft(2, '0')}';
          final hasTasks = allItems.any((t) => t.dueDate == dayStr);

          String dayName;
          if (isToday) {
            dayName = localization.today;
          } else {
            dayName = _weekdayName(day.weekday, localization.isArabic);
          }

          return GestureDetector(
            onTap: () {
              setState(() {
                if (isSelected) {
                  _selectedDate = null;
                } else {
                  _selectedDate = day;
                }
              });
            },
            child: Container(
              width: 54,
              margin: const EdgeInsets.symmetric(horizontal: 4),
              decoration: BoxDecoration(
                color: isSelected
                    ? Theme.of(context).colorScheme.primaryContainer
                    : isToday
                        ? Theme.of(context)
                            .colorScheme
                            .surfaceContainerHighest
                        : Colors.transparent,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: isSelected
                      ? Theme.of(context).colorScheme.primary
                      : isToday
                          ? Theme.of(context).colorScheme.outline
                          : Colors.grey.withAlpha(50),
                ),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    dayName,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight:
                          isSelected || isToday ? FontWeight.bold : FontWeight.normal,
                      color: isSelected
                          ? Theme.of(context).colorScheme.onPrimaryContainer
                          : null,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${day.day}',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      color: isSelected
                          ? Theme.of(context).colorScheme.primary
                          : null,
                    ),
                  ),
                  if (hasTasks) ...[
                    const SizedBox(height: 2),
                    Container(
                      width: 5,
                      height: 5,
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.primary,
                        shape: BoxShape.circle,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  String _weekdayName(int weekday, bool isArabic) {
    if (isArabic) {
      switch (weekday) {
        case DateTime.monday:
          return 'إثنين';
        case DateTime.tuesday:
          return 'ثلاثاء';
        case DateTime.wednesday:
          return 'أربعاء';
        case DateTime.thursday:
          return 'خميس';
        case DateTime.friday:
          return 'جمعة';
        case DateTime.saturday:
          return 'سبت';
        case DateTime.sunday:
          return 'أحد';
      }
    } else {
      switch (weekday) {
        case DateTime.monday:
          return 'Mon';
        case DateTime.tuesday:
          return 'Tue';
        case DateTime.wednesday:
          return 'Wed';
        case DateTime.thursday:
          return 'Thu';
        case DateTime.friday:
          return 'Fri';
        case DateTime.saturday:
          return 'Sat';
        case DateTime.sunday:
          return 'Sun';
      }
    }
    return '';
  }

  Widget _buildDailyBriefingCard(
    BuildContext context,
    AppLocalizations l10n,
    List<Task> allItems,
  ) {
    final completedCount = allItems.where((t) => t.isDone).length;
    final totalCount = allItems.length;
    final xp = completedCount * 10;
    final level = (xp ~/ 50) + 1;
    final theme = Theme.of(context);

    final hour = DateTime.now().hour;
    final isMorning = hour < 14;
    final greeting = isMorning ? 'صباح الخير' : 'مساء الخير';

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            theme.colorScheme.primaryContainer.withAlpha(120),
            theme.colorScheme.surfaceContainerHighest.withAlpha(80),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: theme.colorScheme.primary.withAlpha(40),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.auto_awesome, size: 18, color: theme.colorScheme.primary),
              const SizedBox(width: 8),
              Text(
                '$greeting • ${l10n.aiDailyBriefing}',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 13,
                  color: theme.colorScheme.primary,
                ),
              ),
              const Spacer(),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: theme.colorScheme.primary,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  '${l10n.userLevel} $level • $xp ${l10n.xpPoints}',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    color: theme.colorScheme.onPrimary,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            totalCount == 0
                ? 'لا توجد مهام حتى الآن. اضغط على علامة + لإضافة أول مهمة في يومك!'
                : 'لديك $totalCount مهام مجدولة، تم إنجاز $completedCount منها بنجاح. استمر في التركيز!',
            style: const TextStyle(fontSize: 13, height: 1.4),
          ),
          if (totalCount > 0) ...[
            const SizedBox(height: 10),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: totalCount == 0 ? 0 : completedCount / totalCount,
                minHeight: 6,
                backgroundColor: theme.colorScheme.surfaceContainerHighest,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _TaskTile extends ConsumerStatefulWidget {
  const _TaskTile({
    required this.task,
    required this.isSelectionMode,
    required this.isSelected,
    required this.onToggleSelect,
    required this.onDelete,
  });

  final Task task;
  final bool isSelectionMode;
  final bool isSelected;
  final VoidCallback onToggleSelect;
  final VoidCallback onDelete;

  @override
  ConsumerState<_TaskTile> createState() => _TaskTileState();
}

class _TaskTileState extends ConsumerState<_TaskTile> {
  bool _saving = false;

  Future<void> _setDone(bool done) async {
    setState(() => _saving = true);
    try {
      await ref.read(tasksRepositoryProvider).setDone(widget.task, done);
      ref.invalidate(tasksProvider);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(_safeMessage(error))));
        ref.invalidate(tasksProvider);
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dismissible(
      key: Key(widget.task.id),
      direction: DismissDirection.endToStart,
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.symmetric(horizontal: 20),
        color: Colors.red.shade700,
        child: const Icon(Icons.delete_outline, color: Colors.white),
      ),
      onDismissed: (_) => widget.onDelete(),
      child: InkWell(
        onLongPress: widget.onToggleSelect,
        onTap: widget.isSelectionMode ? widget.onToggleSelect : null,
        child: Container(
          color: widget.isSelected
              ? Theme.of(context).colorScheme.primaryContainer.withAlpha(60)
              : null,
          child: CheckboxListTile(
            value: widget.isSelectionMode
                ? widget.isSelected
                : widget.task.isDone,
            onChanged: _saving
                ? null
                : (value) {
                    if (widget.isSelectionMode) {
                      widget.onToggleSelect();
                    } else {
                      _setDone(value ?? false);
                    }
                  },
            secondary: _saving
                ? const SizedBox.square(
                    dimension: 22,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : null,
            title: Text(
              widget.task.title,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: widget.task.isDone && !widget.isSelectionMode
                  ? TextStyle(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                      decoration: TextDecoration.lineThrough,
                    )
                  : null,
            ),
            subtitle: Text(_taskSubtitle(widget.task)),
            controlAffinity: ListTileControlAffinity.leading,
          ),
        ),
      ),
    );
  }
}

class _TaskLoadError extends StatelessWidget {
  const _TaskLoadError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(message, textAlign: TextAlign.center),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: onRetry,
                child: Text(AppLocalizations.of(context).retry),
              ),
            ],
          ),
        ),
      );
}

Future<void> _showSmartQuickAdd(
  BuildContext context,
  WidgetRef ref, {
  bool initialVoice = false,
}) async {
  final l10n = AppLocalizations.of(context);
  final controller = TextEditingController();
  ParsedTaskResult? parsed;
  var busy = false;
  var isListening = initialVoice;
  String? error;

  await showDialog<void>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(
      builder: (context, setDialogState) {
        Future<void> submit() async {
          final rawText = controller.text.trim();
          if (rawText.isEmpty) return;
          setDialogState(() {
            busy = true;
            error = null;
          });
          try {
            var p = parsed ?? SmartTaskParser.parse(rawText);
            try {
              p = await SmartTaskParser.parseAsync(rawText);
            } catch (_) {}

            final task = await ref.read(tasksRepositoryProvider).createTask(
                  title: p.title,
                  dueDate: p.dueDate,
                  dueTime: p.dueTime,
                );

            if (p.scheduledDateTime != null &&
                p.scheduledDateTime!.isAfter(DateTime.now())) {
              await NotificationService.instance.scheduleAlarm(
                id: task.id.hashCode,
                title: '${l10n.tasks}: ${task.title}',
                body: 'موعد مهمتك المجدولة الآن',
                scheduledDateTime: p.scheduledDateTime!,
              );
            }

            ref.invalidate(tasksProvider);

            if (dialogContext.mounted) {
              Navigator.of(dialogContext).pop();
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(
                    '${l10n.smartAlarmSuccess} (${task.title})',
                  ),
                ),
              );
            }
          } catch (e) {
            if (dialogContext.mounted) {
              setDialogState(() => error = _safeMessage(e));
            }
          } finally {
            if (dialogContext.mounted) setDialogState(() => busy = false);
          }
        }

        return AlertDialog(
          title: Row(
            children: [
              const Icon(Icons.auto_awesome, color: Colors.amber, size: 24),
              const SizedBox(width: 8),
              Expanded(child: Text(l10n.smartAdd)),
              IconButton(
                icon: Icon(
                  isListening ? Icons.mic : Icons.mic_none,
                  color: isListening ? Colors.red : Theme.of(context).colorScheme.primary,
                ),
                tooltip: l10n.voiceMicPrompt,
                onPressed: () {
                  setDialogState(() {
                    isListening = !isListening;
                  });
                },
              ),
            ],
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (isListening) ...[
                  Container(
                    padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
                    margin: const EdgeInsets.only(bottom: 12),
                    decoration: BoxDecoration(
                      color: Colors.red.withAlpha(20),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: Colors.red.withAlpha(80)),
                    ),
                    child: Row(
                      children: [
                        const SizedBox.square(
                          dimension: 16,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.red),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            l10n.voiceMicPrompt,
                            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Colors.red),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                TextField(
                  controller: controller,
                  autofocus: !initialVoice,
                  maxLines: 2,
                  decoration: InputDecoration(
                    hintText: l10n.smartAddHint,
                    hintStyle: const TextStyle(fontSize: 13),
                    suffixIcon: IconButton(
                      icon: const Icon(Icons.mic_outlined),
                      tooltip: l10n.voiceMicPrompt,
                      onPressed: () {
                        setDialogState(() => isListening = !isListening);
                      },
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  onChanged: (val) {
                    setDialogState(() {
                      parsed = SmartTaskParser.parse(val);
                    });
                  },
                ),
                const SizedBox(height: 10),
                // Quick suggested voice clips
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      ActionChip(
                        avatar: const Icon(Icons.schedule, size: 14),
                        label: const Text('بعد نص ساعة', style: TextStyle(fontSize: 11)),
                        onPressed: () {
                          final text = 'تذكير بعد نص ساعة';
                          controller.text = text;
                          setDialogState(() => parsed = SmartTaskParser.parse(text));
                        },
                      ),
                      const SizedBox(width: 6),
                      ActionChip(
                        avatar: const Icon(Icons.calendar_today, size: 14),
                        label: const Text('بكرة 7 مساء', style: TextStyle(fontSize: 11)),
                        onPressed: () {
                          final text = 'مشوار بكرة الساعة 7 بليل';
                          controller.text = text;
                          setDialogState(() => parsed = SmartTaskParser.parse(text));
                        },
                      ),
                      const SizedBox(width: 6),
                      ActionChip(
                        avatar: const Icon(Icons.alarm, size: 14),
                        label: const Text('بعد ساعتين', style: TextStyle(fontSize: 11)),
                        onPressed: () {
                          final text = 'مهمة بعد ساعتين';
                          controller.text = text;
                          setDialogState(() => parsed = SmartTaskParser.parse(text));
                        },
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                if (parsed != null && parsed!.title.isNotEmpty) ...[
                  Card(
                    color: Theme.of(context)
                        .colorScheme
                        .primaryContainer
                        .withAlpha(80),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              const Icon(Icons.check_circle,
                                  size: 16, color: Colors.green),
                              const SizedBox(width: 6),
                              Expanded(
                                child: Text(
                                  '${l10n.detectedTitle}: ${parsed!.title}',
                                  style: const TextStyle(
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          if (parsed!.dueDate != null) ...[
                            const SizedBox(height: 6),
                            Row(
                              children: [
                                const Icon(Icons.calendar_today, size: 14),
                                const SizedBox(width: 6),
                                Text(
                                  '${l10n.detectedDate}: ${parsed!.dueDate}',
                                  style: const TextStyle(fontSize: 13),
                                ),
                              ],
                            ),
                          ],
                          if (parsed!.dueTime != null) ...[
                            const SizedBox(height: 6),
                            Row(
                              children: [
                                const Icon(Icons.alarm,
                                    size: 14, color: Colors.deepOrange),
                                const SizedBox(width: 6),
                                Text(
                                  '${l10n.detectedAlarm}: ${parsed!.dueTime}',
                                  style: const TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.bold,
                                    color: Colors.deepOrange,
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ],
                if (error != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: busy ? null : () => Navigator.of(dialogContext).pop(),
              child: Text(l10n.cancel),
            ),
            FilledButton.icon(
              onPressed: (busy || parsed == null || parsed!.title.isEmpty)
                  ? null
                  : submit,
              icon: busy
                  ? const SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.alarm_add, size: 18),
              label: Text(l10n.saveAndSetAlarm),
            ),
          ],
        );
      },
    ),
  );
  controller.dispose();
}

Future<void> _showAddTask(
  BuildContext context,
  WidgetRef ref, {
  DateTime? initialDate,
}) async {
  final l10n = AppLocalizations.of(context);
  final title = TextEditingController();
  final formKey = GlobalKey<FormState>();

  DateTime? selectedDate = initialDate;
  TimeOfDay? selectedTime = initialDate != null ? TimeOfDay.now() : null;
  var busy = false;
  String? error;

  await showDialog<void>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(
      builder: (context, setDialogState) {
        Future<void> pickDate() async {
          final now = DateTime.now();
          final picked = await showDatePicker(
            context: context,
            initialDate: selectedDate ?? now,
            firstDate: DateTime(2020),
            lastDate: now.add(const Duration(days: 3650)),
          );
          if (picked != null) {
            setDialogState(() {
              selectedDate = picked;
              selectedTime ??= TimeOfDay.now();
            });
          }
        }

        Future<void> pickTime() async {
          final picked = await showTimePicker(
            context: context,
            initialTime: selectedTime ?? TimeOfDay.now(),
          );
          if (picked != null) {
            setDialogState(() {
              selectedTime = picked;
              selectedDate ??= DateTime.now();
            });
          }
        }

        Future<void> submit() async {
          if (!formKey.currentState!.validate()) return;
          setDialogState(() {
            busy = true;
            error = null;
          });
          try {
            String? dueDateStr;
            String? dueTimeStr;
            DateTime? fullDateTime;

            if (selectedDate != null) {
              final y = selectedDate!.year.toString().padLeft(4, '0');
              final m = selectedDate!.month.toString().padLeft(2, '0');
              final d = selectedDate!.day.toString().padLeft(2, '0');
              dueDateStr = '$y-$m-$d';

              if (selectedTime != null) {
                final hh = selectedTime!.hour.toString().padLeft(2, '0');
                final mm = selectedTime!.minute.toString().padLeft(2, '0');
                dueTimeStr = '$hh:$mm';
                fullDateTime = DateTime(
                  selectedDate!.year,
                  selectedDate!.month,
                  selectedDate!.day,
                  selectedTime!.hour,
                  selectedTime!.minute,
                );
              }
            }

            final task = await ref.read(tasksRepositoryProvider).createTask(
                  title: title.text,
                  dueDate: dueDateStr,
                  dueTime: dueTimeStr,
                );

            if (fullDateTime != null && fullDateTime.isAfter(DateTime.now())) {
              final alarmId = task.id.hashCode;
              await NotificationService.instance.scheduleAlarm(
                id: alarmId,
                title: '${l10n.tasks}: ${task.title}',
                body: l10n.taskTitle,
                scheduledDateTime: fullDateTime,
              );
            }

            ref.invalidate(tasksProvider);

            if (dialogContext.mounted) {
              Navigator.of(dialogContext).pop();
              if (fullDateTime != null) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text(l10n.alarmScheduled)),
                );
              }
            }
          } catch (exception) {
            if (dialogContext.mounted) {
              setDialogState(() => error = _safeMessage(exception));
            }
          } finally {
            if (dialogContext.mounted) setDialogState(() => busy = false);
          }
        }

        return AlertDialog(
          title: Text(l10n.addTask),
          content: Form(
            key: formKey,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextFormField(
                    controller: title,
                    autofocus: true,
                    maxLength: 300,
                    decoration: InputDecoration(
                      labelText: l10n.taskTitle,
                    ),
                    validator: (value) => value == null || value.trim().isEmpty
                        ? l10n.taskTitle
                        : null,
                    onFieldSubmitted: (_) => submit(),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    l10n.setAlarm,
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.primary,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: pickDate,
                          icon: const Icon(Icons.calendar_today, size: 16),
                          label: Text(
                            selectedDate == null
                                ? l10n.pickDate
                                : '${selectedDate!.year}-${selectedDate!.month.toString().padLeft(2, '0')}-${selectedDate!.day.toString().padLeft(2, '0')}',
                            style: const TextStyle(fontSize: 12),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: pickTime,
                          icon: const Icon(Icons.access_time, size: 16),
                          label: Text(
                            selectedTime == null
                                ? l10n.pickTime
                                : '${selectedTime!.hour.toString().padLeft(2, '0')}:${selectedTime!.minute.toString().padLeft(2, '0')}',
                            style: const TextStyle(fontSize: 12),
                          ),
                        ),
                      ),
                    ],
                  ),
                  if (selectedDate != null)
                    Align(
                      alignment: AlignmentDirectional.centerEnd,
                      child: TextButton(
                        onPressed: () {
                          setDialogState(() {
                            selectedDate = null;
                            selectedTime = null;
                          });
                        },
                        child: Text(
                          l10n.noAlarm,
                          style: TextStyle(
                            fontSize: 12,
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                      ),
                    ),
                  if (error != null) ...[
                    const SizedBox(height: 8),
                    Text(
                      error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: busy ? null : () => Navigator.of(dialogContext).pop(),
              child: Text(l10n.cancel),
            ),
            FilledButton(
              onPressed: busy ? null : submit,
              child: busy
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(l10n.save),
            ),
          ],
        );
      },
    ),
  );
  title.dispose();
}

String _taskSubtitle(Task task) {
  final parts = <String>[task.status.replaceAll('_', ' '), task.priority];
  if (task.dueDate != null) {
    var dueStr = 'Due ${task.dueDate}';
    if (task.dueTime != null) dueStr += ' ${task.dueTime}';
    parts.add(dueStr);
  }
  return parts.join(' · ');
}

String _safeMessage(Object error) {
  if (error is ApiException) {
    if (error.code == 'VERSION_CONFLICT') {
      return 'This task changed. The list has been refreshed.';
    }
    return error.message;
  }
  return 'Could not complete the request. Try again.';
}
