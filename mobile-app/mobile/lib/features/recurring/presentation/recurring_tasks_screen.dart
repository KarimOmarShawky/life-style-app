import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/core/widgets/feature_widgets.dart';
import 'package:lifestyle_mobile/features/recurring/data/recurring_task_model.dart';
import 'package:lifestyle_mobile/features/recurring/presentation/recurring_labels.dart';
import 'package:lifestyle_mobile/features/recurring/presentation/recurring_task_form_screen.dart';
import 'package:lifestyle_mobile/features/recurring/state/recurring_tasks_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

class RecurringTasksScreen extends ConsumerWidget {
  const RecurringTasksScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final tasksAsync = ref.watch(recurringTasksProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.recurringTasksTitle)),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(recurringTasksProvider),
        child: tasksAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => FeatureErrorView(
            message: error.toString(),
            onRetry: () => ref.invalidate(recurringTasksProvider),
          ),
          data: (tasks) {
            if (tasks.isEmpty) {
              return ListView(
                children: [
                  FeatureEmptyView(
                    icon: Icons.event_repeat_outlined,
                    message: l10n.noRecurringTasks,
                  ),
                ],
              );
            }
            return ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: tasks.length,
              itemBuilder: (context, index) {
                final task = tasks[index];
                return Dismissible(
                  key: ValueKey('recurring-${task.id}'),
                  direction: DismissDirection.endToStart,
                  background: const DeleteSwipeBackground(),
                  confirmDismiss: (_) => confirmDestructiveAction(
                    context,
                    title: l10n.deleteRecurringTaskConfirm,
                    detail: task.title,
                  ),
                  onDismissed: (_) async {
                    await ref
                        .read(recurringTasksRepositoryProvider)
                        .deleteRecurringTask(task.id);
                    ref.invalidate(recurringTasksProvider);
                  },
                  child: _RecurringTaskCard(
                    task: task,
                    onTap: () => openRecurringTaskForm(
                      context,
                      ref,
                      task: task,
                    ),
                    onToggle: () => runWithErrorSnackBar(context, () async {
                      final nextStatus =
                          task.status == 'active' ? 'paused' : 'active';
                      await ref
                          .read(recurringTasksRepositoryProvider)
                          .updateRecurringTask(task.id, {
                        'status': nextStatus,
                        'version': task.version,
                      });
                      ref.invalidate(recurringTasksProvider);
                    }),
                  ),
                );
              },
            );
          },
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => openRecurringTaskForm(context, ref),
        icon: const Icon(Icons.add),
        label: Text(l10n.addRecurringTask),
      ),
    );
  }
}

class _RecurringTaskCard extends StatelessWidget {
  const _RecurringTaskCard({
    required this.task,
    required this.onTap,
    required this.onToggle,
  });

  final RecurringTask task;
  final VoidCallback onTap;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final dueTime = task.dueTime;
    final isEnded = task.status == 'ended';
    final isActive = task.status == 'active';

    return Card(
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      task.title,
                      style: theme.textTheme.titleMedium,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      recurrenceSummary(context, l10n, task.recurrence),
                      style: theme.textTheme.bodySmall,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      [
                        recurringStatusLabel(l10n, task.status),
                        priorityLabel(l10n, task.priority),
                        if (dueTime != null) dueTime,
                      ].join(' · '),
                      style: theme.textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
              if (!isEnded)
                IconButton(
                  tooltip: isActive ? l10n.pauseRecurring : l10n.resumeRecurring,
                  icon: Icon(
                    isActive ? Icons.pause_circle_outline : Icons.play_circle_outline,
                  ),
                  onPressed: onToggle,
                ),
            ],
          ),
        ),
      ),
    );
  }
}
