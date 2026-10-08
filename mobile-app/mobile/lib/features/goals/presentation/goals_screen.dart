import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/core/time/api_time.dart';
import 'package:lifestyle_mobile/core/widgets/feature_widgets.dart';
import 'package:lifestyle_mobile/features/goals/data/goal_model.dart';
import 'package:lifestyle_mobile/features/goals/presentation/goal_detail_screen.dart';
import 'package:lifestyle_mobile/features/goals/presentation/goal_form_screen.dart';
import 'package:lifestyle_mobile/features/goals/presentation/goal_labels.dart';
import 'package:lifestyle_mobile/features/goals/state/goals_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

class GoalsScreen extends ConsumerWidget {
  const GoalsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final goalsAsync = ref.watch(goalsProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.goalsTitle)),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(goalsProvider),
        child: goalsAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => FeatureErrorView(
            message: error.toString(),
            onRetry: () => ref.invalidate(goalsProvider),
          ),
          data: (goals) {
            if (goals.isEmpty) {
              return ListView(
                children: [
                  FeatureEmptyView(
                    icon: Icons.flag_outlined,
                    message: l10n.noGoals,
                  ),
                ],
              );
            }
            return ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: goals.length,
              itemBuilder: (context, index) {
                final goal = goals[index];
                return Dismissible(
                  key: ValueKey('goal-${goal.id}'),
                  direction: DismissDirection.endToStart,
                  background: const DeleteSwipeBackground(),
                  confirmDismiss: (_) => confirmDestructiveAction(
                    context,
                    title: l10n.deleteGoalConfirm,
                    detail: goal.title,
                  ),
                  onDismissed: (_) async {
                    await ref.read(goalsRepositoryProvider).deleteGoal(goal.id);
                    ref.invalidate(goalsProvider);
                  },
                  child: _GoalCard(
                    goal: goal,
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => GoalDetailScreen(goalId: goal.id),
                      ),
                    ),
                  ),
                );
              },
            );
          },
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => openGoalForm(context, ref),
        icon: const Icon(Icons.add),
        label: Text(l10n.addGoal),
      ),
    );
  }
}

class _GoalCard extends StatelessWidget {
  const _GoalCard({required this.goal, required this.onTap});

  final Goal goal;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final subtitle = goal.isMilestoneGoal
        ? l10n.milestonesProgress(goal.completedMilestones, goal.totalMilestones)
        : l10n.goalValueLabel(
            formatDecimal(goal.currentValue).isEmpty
                ? '0'
                : formatDecimal(goal.currentValue),
            formatDecimal(goal.targetValue),
            goal.unit ?? '',
          );

    return Card(
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      goal.title,
                      style: theme.textTheme.titleMedium,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Chip(
                    label: Text(goalStatusLabel(l10n, goal.status)),
                    visualDensity: VisualDensity.compact,
                  ),
                ],
              ),
              const SizedBox(height: 10),
              LinearProgressIndicator(
                value: progressFraction(goal.progressPercentage),
                minHeight: 6,
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: Text(subtitle, style: theme.textTheme.bodySmall),
                  ),
                  Text(
                    l10n.goalProgressLabel(goal.progressPercentage.round()),
                    style: theme.textTheme.bodySmall,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
