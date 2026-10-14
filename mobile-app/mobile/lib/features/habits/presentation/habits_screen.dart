import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/habits/state/habits_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

import 'widgets/habit_card.dart';

class HabitsScreen extends ConsumerWidget {
  const HabitsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final habitsAsync = ref.watch(habitsProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.dailyHabits)),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(habitsProvider);
        },
        child: habitsAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (err, _) => Center(child: Text('${l10n.errorTitle}: $err')),
          data: (habits) => habits.isEmpty
              ? Center(
                  child: Text(
                    l10n.noHabits,
                    textAlign: TextAlign.center,
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: habits.length,
                  itemBuilder: (context, index) {
                    final habit = habits[index];
                    return Dismissible(
                      key: Key(habit.id),
                      direction: DismissDirection.endToStart,
                      background: Container(
                        alignment: Alignment.centerRight,
                        padding: const EdgeInsets.symmetric(horizontal: 20),
                        margin: const EdgeInsets.symmetric(vertical: 8),
                        decoration: BoxDecoration(
                          color: Colors.red.shade700,
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: const Icon(Icons.delete_outline,
                            color: Colors.white),
                      ),
                      confirmDismiss: (_) async {
                        return await showDialog<bool>(
                          context: context,
                          builder: (ctx) => AlertDialog(
                            title: Text(l10n.deleteConfirm),
                            content: Text(habit.name),
                            actions: [
                              TextButton(
                                onPressed: () => Navigator.of(ctx).pop(false),
                                child: Text(l10n.cancel),
                              ),
                              FilledButton(
                                style: FilledButton.styleFrom(
                                    backgroundColor: Colors.red),
                                onPressed: () => Navigator.of(ctx).pop(true),
                                child: Text(l10n.delete),
                              ),
                            ],
                          ),
                        );
                      },
                      onDismissed: (_) async {
                        await ref
                            .read(habitsRepositoryProvider)
                            .deleteHabit(habit.id);
                        ref.invalidate(habitsProvider);
                      },
                      child: HabitCard(habit: habit),
                    );
                  },
                ),
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showAddHabit(context, ref),
        child: const Icon(Icons.add),
      ),
    );
  }
}

Future<void> _showAddHabit(BuildContext context, WidgetRef ref) async {
  final l10n = AppLocalizations.of(context);
  final nameController = TextEditingController();
  final descController = TextEditingController();
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
            final now = DateTime.now();
            final today =
                '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
            await ref.read(habitsRepositoryProvider).createHabit(
                  name: nameController.text,
                  description: descController.text.trim().isEmpty
                      ? null
                      : descController.text,
                  startDate: today,
                );
            ref.invalidate(habitsProvider);
            if (dialogContext.mounted) Navigator.of(dialogContext).pop();
          } catch (e) {
            if (dialogContext.mounted) {
              setDialogState(() => error = e.toString());
            }
          } finally {
            if (dialogContext.mounted) setDialogState(() => busy = false);
          }
        }

        return AlertDialog(
          title: Text(l10n.addHabit),
          content: Form(
            key: formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(
                  controller: nameController,
                  autofocus: true,
                  decoration: InputDecoration(
                    labelText: l10n.habitName,
                  ),
                  validator: (v) =>
                      v == null || v.trim().isEmpty ? l10n.habitName : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: descController,
                  decoration: InputDecoration(
                    labelText: l10n.description,
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
  nameController.dispose();
  descController.dispose();
}
