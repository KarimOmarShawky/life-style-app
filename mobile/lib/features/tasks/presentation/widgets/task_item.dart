import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/tasks/data/task_model.dart';

class TaskItem extends ConsumerWidget {
  const TaskItem({super.key, required this.task, required this.onToggle});

  final Task task;
  final ValueChanged<bool> onToggle;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
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
      subtitle: Text(taskSubtitle(task)),
    );
  }
}

String taskSubtitle(Task task) {
  final parts = <String>[task.status.replaceAll('_', ' '), task.priority];
  if (task.dueDate != null) parts.add('Due ${task.dueDate}');
  return parts.join(' · ');
}
