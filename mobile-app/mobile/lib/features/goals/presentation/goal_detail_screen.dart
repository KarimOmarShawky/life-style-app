import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/core/time/api_time.dart';
import 'package:lifestyle_mobile/core/widgets/feature_widgets.dart';
import 'package:lifestyle_mobile/features/goals/data/goal_model.dart';
import 'package:lifestyle_mobile/features/goals/presentation/goal_form_screen.dart';
import 'package:lifestyle_mobile/features/goals/presentation/goal_labels.dart';
import 'package:lifestyle_mobile/features/goals/state/goals_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

final RegExp _progressPattern = RegExp(r'^\d+(\.\d{1,4})?$');

/// Shows one goal with its progress, status and milestones.
class GoalDetailScreen extends ConsumerWidget {
  const GoalDetailScreen({super.key, required this.goalId});

  final String goalId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final goalAsync = ref.watch(goalDetailProvider(goalId));
    final goal = goalAsync.valueOrNull;

    return Scaffold(
      appBar: AppBar(
        title: Text(goal?.title ?? l10n.goalsTitle),
        actions: goal == null
            ? const <Widget>[]
            : [
                IconButton(
                  tooltip: l10n.editGoal,
                  icon: const Icon(Icons.edit_outlined),
                  onPressed: () async {
                    await openGoalForm(context, ref, goal: goal);
                    if (context.mounted) _refresh(ref);
                  },
                ),
                IconButton(
                  tooltip: l10n.delete,
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () => _delete(context, ref, goal),
                ),
              ],
      ),
      body: goalAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => FeatureErrorView(
          message: error.toString(),
          onRetry: () => ref.invalidate(goalDetailProvider(goalId)),
        ),
        data: (loaded) => _buildBody(context, ref, loaded),
      ),
    );
  }

  void _refresh(WidgetRef ref) {
    ref.invalidate(goalDetailProvider(goalId));
    ref.invalidate(goalsProvider);
  }

  /// Runs a mutation and reports any API error in a snackbar.
  Future<void> _run(
    BuildContext context,
    Future<void> Function() action,
  ) async {
    try {
      await action();
    } catch (error) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  Future<void> _delete(BuildContext context, WidgetRef ref, Goal goal) async {
    final l10n = AppLocalizations.of(context);
    final confirmed = await confirmDestructiveAction(
      context,
      title: l10n.deleteGoalConfirm,
      detail: goal.title,
    );
    if (!confirmed || !context.mounted) return;
    await _run(context, () async {
      await ref.read(goalsRepositoryProvider).deleteGoal(goal.id);
      ref.invalidate(goalsProvider);
      if (context.mounted) Navigator.of(context).pop();
    });
  }

  Widget _buildBody(BuildContext context, WidgetRef ref, Goal goal) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final description = goal.description;
    final currentText = formatDecimal(goal.currentValue);
    final valueText = goal.isMilestoneGoal
        ? l10n.milestonesProgress(
            goal.completedMilestones,
            goal.totalMilestones,
          )
        : l10n.goalValueLabel(
            currentText.isEmpty ? '0' : currentText,
            formatDecimal(goal.targetValue),
            goal.unit ?? '',
          );

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (description != null) ...[
          Text(description, style: theme.textTheme.bodyMedium),
          const SizedBox(height: 16),
        ],
        Row(
          children: [
            Expanded(
              child: Text(valueText, style: theme.textTheme.titleSmall),
            ),
            PopupMenuButton<String>(
              tooltip: l10n.statusFieldLabel,
              onSelected: (status) => _run(context, () async {
                await ref
                    .read(goalsRepositoryProvider)
                    .updateGoal(goal.id, {
                      'status': status,
                      'version': goal.version,
                    });
                _refresh(ref);
              }),
              itemBuilder: (menuContext) => [
                for (final status in goalStatuses)
                  PopupMenuItem<String>(
                    value: status,
                    child: Text(goalStatusLabel(l10n, status)),
                  ),
              ],
              child: Chip(label: Text(goalStatusLabel(l10n, goal.status))),
            ),
          ],
        ),
        const SizedBox(height: 12),
        LinearProgressIndicator(
          value: progressFraction(goal.progressPercentage),
          minHeight: 8,
        ),
        const SizedBox(height: 4),
        Text(
          l10n.goalProgressLabel(goal.progressPercentage.round()),
          style: theme.textTheme.bodySmall,
        ),
        if (!goal.isMilestoneGoal) ...[
          const SizedBox(height: 16),
          FilledButton.tonalIcon(
            onPressed: () => _updateProgress(context, ref, goal),
            icon: const Icon(Icons.edit_note),
            label: Text(l10n.updateProgress),
          ),
        ],
        if (goal.isMilestoneGoal) ...[
          const SizedBox(height: 24),
          Row(
            children: [
              Expanded(
                child: Text(
                  l10n.milestonesTitle,
                  style: theme.textTheme.titleMedium,
                ),
              ),
              TextButton.icon(
                onPressed: () => _addMilestone(context, ref, goal),
                icon: const Icon(Icons.add),
                label: Text(l10n.addMilestone),
              ),
            ],
          ),
          if (goal.milestones.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text(l10n.noMilestones),
            ),
          for (final milestone in goal.milestones)
            _milestoneTile(context, ref, goal, milestone),
        ],
      ],
    );
  }

  Widget _milestoneTile(
    BuildContext context,
    WidgetRef ref,
    Goal goal,
    GoalMilestone milestone,
  ) {
    final l10n = AppLocalizations.of(context);
    final due = milestone.dueDate;
    return Dismissible(
      key: ValueKey('milestone-${milestone.id}'),
      direction: DismissDirection.endToStart,
      background: const DeleteSwipeBackground(),
      confirmDismiss: (_) => confirmDestructiveAction(
        context,
        title: l10n.deleteMilestoneConfirm,
        detail: milestone.title,
      ),
      onDismissed: (_) => _run(context, () async {
        await ref
            .read(goalsRepositoryProvider)
            .deleteMilestone(goal.id, milestone.id);
        _refresh(ref);
      }),
      child: CheckboxListTile(
        contentPadding: EdgeInsets.zero,
        controlAffinity: ListTileControlAffinity.leading,
        value: milestone.completed,
        title: Text(
          milestone.title,
          style: milestone.completed
              ? const TextStyle(decoration: TextDecoration.lineThrough)
              : null,
        ),
        subtitle: due == null
            ? null
            : Text(formatDisplayDate(context, due, emptyText: '')),
        onChanged: (value) => _run(context, () async {
          await ref
              .read(goalsRepositoryProvider)
              .updateMilestone(goal.id, milestone.id, {
                'completed': value ?? false,
                'version': milestone.version,
              });
          _refresh(ref);
        }),
      ),
    );
  }

  Future<void> _updateProgress(
    BuildContext context,
    WidgetRef ref,
    Goal goal,
  ) async {
    final l10n = AppLocalizations.of(context);
    final controller = TextEditingController(
      text: formatDecimal(goal.currentValue),
    );
    final entered = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.updateProgress),
        content: TextField(
          controller: controller,
          autofocus: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(
            labelText: l10n.goalCurrentLabel,
            suffixText: goal.unit,
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.of(dialogContext).pop(controller.text.trim()),
            child: Text(l10n.save),
          ),
        ],
      ),
    );
    controller.dispose();
    if (entered == null || entered.isEmpty || !context.mounted) return;
    if (!_progressPattern.hasMatch(entered)) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(l10n.goalCurrentInvalid)));
      return;
    }
    await _run(context, () async {
      await ref.read(goalsRepositoryProvider).updateGoal(goal.id, {
        'currentValue': entered,
        'version': goal.version,
      });
      _refresh(ref);
    });
  }

  Future<void> _addMilestone(
    BuildContext context,
    WidgetRef ref,
    Goal goal,
  ) async {
    final l10n = AppLocalizations.of(context);
    final controller = TextEditingController();
    final entered = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.addMilestone),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLength: 200,
          decoration: InputDecoration(labelText: l10n.milestoneTitleLabel),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.of(dialogContext).pop(controller.text.trim()),
            child: Text(l10n.save),
          ),
        ],
      ),
    );
    controller.dispose();
    if (entered == null || entered.isEmpty || !context.mounted) return;
    await _run(context, () async {
      await ref.read(goalsRepositoryProvider).addMilestone(goal.id, {
        'title': entered,
      });
      _refresh(ref);
    });
  }
}
