import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/tasks/data/task_model.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

class TaskItem extends ConsumerWidget {
  const TaskItem({super.key, required this.task, required this.onToggle});

  final Task task;
  final ValueChanged<bool> onToggle;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    return CheckboxListTile(
      value: task.isDone,
      onChanged: (checked) => onToggle(checked ?? false),
      title: Text(
        task.title,
        style: TextStyle(
          decoration: task.isDone ? TextDecoration.lineThrough : null,
          color: task.isDone ? Colors.grey : null,
        ),
      ),
      subtitle: Text(taskSubtitle(l10n, task)),
    );
  }
}

String taskSubtitle(AppLocalizations l10n, Task task) {
  final statusLabel = task.isDone ? l10n.statusDone : l10n.statusTodo;

  String priorityLabel;
  switch (task.priority.toLowerCase()) {
    case 'high':
      priorityLabel = l10n.priorityHigh;
      break;
    case 'low':
      priorityLabel = l10n.priorityLow;
      break;
    default:
      priorityLabel = l10n.priorityMedium;
  }

  final parts = <String>[statusLabel, priorityLabel];
  if (task.dueDate != null) {
    parts.add('${l10n.duePrefix} ${task.dueDate}');
  }
  return parts.join(' · ');
}
