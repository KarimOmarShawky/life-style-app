import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/api_client.dart';
import '../data/models.dart';
import '../l10n/app_localizations.dart';
import '../state/providers.dart';

class TasksScreen extends ConsumerWidget {
  const TasksScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final localization = AppLocalizations.of(context);
    final tasks = ref.watch(tasksProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(localization.tasks),
        actions: [
          IconButton(
            tooltip: localization.profile,
            onPressed: () => Navigator.of(context).pushNamed('/profile'),
            icon: const Icon(Icons.person_outline),
          ),
        ],
      ),
      body: tasks.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => _TaskLoadError(
          message: _safeMessage(error),
          onRetry: () => ref.invalidate(tasksProvider),
        ),
        data: (items) => RefreshIndicator(
          onRefresh: () async {
            await ref.refresh(tasksProvider.future);
          },
          child: items.isEmpty
              ? ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  children: [
                    const SizedBox(height: 150),
                    Icon(
                      Icons.check_circle_outline,
                      size: 48,
                      color: Theme.of(context).colorScheme.primary,
                    ),
                    const SizedBox(height: 12),
                    Center(child: Text(localization.noTasks)),
                  ],
                )
              : ListView.separated(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  itemCount: items.length,
                  separatorBuilder: (_, __) =>
                      const Divider(height: 1, indent: 72),
                  itemBuilder: (context, index) =>
                      _TaskTile(task: items[index]),
                ),
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showAddTask(context, ref),
        icon: const Icon(Icons.add),
        label: Text(localization.addTask),
      ),
    );
  }
}

class _TaskTile extends ConsumerStatefulWidget {
  const _TaskTile({required this.task});

  final Task task;

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
  Widget build(BuildContext context) => CheckboxListTile(
    value: widget.task.isDone,
    onChanged: _saving ? null : (value) => _setDone(value ?? false),
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
      style: widget.task.isDone
          ? TextStyle(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
              decoration: TextDecoration.lineThrough,
            )
          : null,
    ),
    subtitle: Text(_taskSubtitle(widget.task)),
    controlAffinity: ListTileControlAffinity.leading,
  );
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

Future<void> _showAddTask(BuildContext context, WidgetRef ref) async {
  final title = TextEditingController();
  final formKey = GlobalKey<FormState>();
  var busy = false;
  String? error;
  await showDialog<void>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(
      builder: (context, setDialogState) {
        Future<void> submit() async {
          if (!formKey.currentState!.validate()) return;
          setDialogState(() {
            busy = true;
            error = null;
          });
          try {
            await ref.read(tasksRepositoryProvider).createTask(title.text);
            ref.invalidate(tasksProvider);
            if (dialogContext.mounted) Navigator.of(dialogContext).pop();
          } catch (exception) {
            if (dialogContext.mounted) {
              setDialogState(() => error = _safeMessage(exception));
            }
          } finally {
            if (dialogContext.mounted) setDialogState(() => busy = false);
          }
        }

        return AlertDialog(
          title: Text(AppLocalizations.of(context).addTask),
          content: Form(
            key: formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(
                  controller: title,
                  autofocus: true,
                  maxLength: 300,
                  decoration: InputDecoration(
                    labelText: AppLocalizations.of(context).taskTitle,
                  ),
                  validator: (value) => value == null || value.trim().isEmpty
                      ? 'Enter a task title.'
                      : null,
                  onFieldSubmitted: (_) => submit(),
                ),
                if (error != null)
                  Text(
                    error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: busy ? null : () => Navigator.of(dialogContext).pop(),
              child: Text(AppLocalizations.of(context).cancel),
            ),
            FilledButton(
              onPressed: busy ? null : submit,
              child: busy
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(AppLocalizations.of(context).save),
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
  if (task.dueDate != null) parts.add('Due ${task.dueDate}');
  return parts.join(' · ');
}

String _safeMessage(Object error) {
  if (error is ApiException) {
    if (error.code == 'VERSION_CONFLICT')
      return 'This task changed. The list has been refreshed.';
    return error.message;
  }
  return 'Could not complete the request. Try again.';
}
