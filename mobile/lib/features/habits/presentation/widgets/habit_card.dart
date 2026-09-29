import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/habits/data/habit_model.dart';
import 'package:lifestyle_mobile/features/habits/state/habits_provider.dart';

class HabitCard extends ConsumerWidget {
  const HabitCard({super.key, required this.habit});

  final Habit habit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final now = DateTime.now();
    final today =
        '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';

    return Card(
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: ListTile(
        title: Text(
          habit.name,
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
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
                color: const Color(0x26FFA500),
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
              icon: const Icon(
                Icons.check_circle_outline,
                color: Color(0xFF315C4C),
              ),
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
