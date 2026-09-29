import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models.dart';
import '../state/providers.dart';

class HabitsScreen extends ConsumerWidget {
  const HabitsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final habitsAsync = ref.watch(habitsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Daily Habits'),
      ),
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
                    return _HabitCard(habit: habit);
                  },
                ),
        ),
      ),
    );
  }
}

class _HabitCard extends ConsumerWidget {
  const _HabitCard({required this.habit});

  final Habit habit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final now = DateTime.now();
    final today =
        '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';

    return Card(
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: ListTile(
        title: Text(habit.name, style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(
          habit.description ?? 'Daily routine',
          style: TextStyle(color: Colors.grey[600]),
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: Colors.orange.withOpacity(0.15),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  const Text('🔥 ', style: TextStyle(fontSize: 12)),
                  Text(
                    '${habit.currentStreak}',
                    style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      color: Colors.deepOrange,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            IconButton(
              icon: const Icon(Icons.check_circle_outline, color: Color(0xFF315C4C)),
              onPressed: () async {
                await ref
                    .read(habitsRepositoryProvider)
                    .checkinHabit(habit.id, today, status: 'done');
                ref.invalidate(habitsProvider);
              },
            ),
          ],
        ),
      ),
    );
  }
}
