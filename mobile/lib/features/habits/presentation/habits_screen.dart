import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/models.dart';
import 'package:lifestyle_mobile/state/providers.dart';

import 'widgets/habit_card.dart';

class HabitsScreen extends ConsumerWidget {
  const HabitsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final habitsAsync = ref.watch(habitsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Daily Habits')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(habitsProvider);
        },
        child: habitsAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (err, _) => Center(child: Text('Error loading habits: $err')),
          data: (habits) => habits.isEmpty
              ? const Center(
                  child: Text(
                    'No habits created yet.\nBuild a daily routine!',
                    textAlign: TextAlign.center,
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: habits.length,
                  itemBuilder: (context, index) {
                    final habit = habits[index];
                    return HabitCard(habit: habit);
                  },
                ),
        ),
      ),
    );
  }
}
