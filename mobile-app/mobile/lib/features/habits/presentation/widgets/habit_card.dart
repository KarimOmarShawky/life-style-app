import 'package:lifestyle_mobile/features/focus_shield/focus_shield_models.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_provider.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/habits/data/habit_model.dart';
import 'package:lifestyle_mobile/features/habits/state/habits_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

class HabitCard extends ConsumerStatefulWidget {
  const HabitCard({super.key, required this.habit});

  final Habit habit;

  @override
  ConsumerState<HabitCard> createState() => _HabitCardState();
}

class _HabitCardState extends ConsumerState<HabitCard> {
  bool _checkingIn = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final now = DateTime.now();
    final today =
        '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';

    final habit = widget.habit;
    final colorScheme = Theme.of(context).colorScheme;

    return Card(
      margin: const EdgeInsets.symmetric(vertical: 8),
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Top Row: Habit Name, Streaks, Checkin Button
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        habit.name,
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 17,
                        ),
                      ),
                      if (habit.description != null &&
                          habit.description!.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text(
                          habit.description!,
                          style: TextStyle(
                            color: colorScheme.outline,
                            fontSize: 13,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                // Streak Badges
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: Colors.deepOrange.withAlpha(30),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.local_fire_department,
                          size: 16, color: Colors.deepOrange),
                      const SizedBox(width: 4),
                      Text(
                        '${habit.currentStreak} ${l10n.days}',
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 13,
                          color: Colors.deepOrange,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                // Checkin button
                IconButton.filledTonal(
                  icon: _checkingIn
                      ? const SizedBox.square(
                          dimension: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.check),
                  onPressed: _checkingIn
                      ? null
                      : () async {
                          setState(() => _checkingIn = true);
                          try {
                            await ref
                                .read(habitsRepositoryProvider)
                                .checkinHabit(habit.id, today, status: 'done');
                            await ref
                                .read(focusShieldProvider.notifier)
                                .award(XpType.habit, habit.id, dateKey: today);
                            ref.invalidate(habitsProvider);
                            if (context.mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                  content: Text(l10n.completedToday),
                                  duration: const Duration(seconds: 2),
                                ),
                              );
                            }
                          } finally {
                            if (mounted) setState(() => _checkingIn = false);
                          }
                        },
                ),
              ],
            ),
            const SizedBox(height: 14),
            const Divider(height: 1),
            const SizedBox(height: 10),

            // 7-Day Weekly Progress Strip
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: _build7DayStrip(context, l10n, now),
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _build7DayStrip(
    BuildContext context,
    AppLocalizations l10n,
    DateTime now,
  ) {
    final widgets = <Widget>[];
    final colorScheme = Theme.of(context).colorScheme;

    // Last 6 days + today
    for (var i = 6; i >= 0; i--) {
      final day = now.subtract(Duration(days: i));
      final isToday = i == 0;

      final dayLetter = _dayLetter(day.weekday, l10n.isArabic);

      widgets.add(
        Column(
          children: [
            Text(
              dayLetter,
              style: TextStyle(
                fontSize: 11,
                fontWeight: isToday ? FontWeight.bold : FontWeight.normal,
                color: isToday ? colorScheme.primary : colorScheme.outline,
              ),
            ),
            const SizedBox(height: 6),
            Container(
              width: 28,
              height: 28,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: isToday
                    ? colorScheme.primaryContainer
                    : colorScheme.surfaceContainerHighest,
                border: isToday
                    ? Border.all(color: colorScheme.primary, width: 2)
                    : null,
              ),
              child: Center(
                child: Text(
                  '${day.day}',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: isToday ? FontWeight.bold : FontWeight.normal,
                    color: isToday ? colorScheme.primary : null,
                  ),
                ),
              ),
            ),
          ],
        ),
      );
    }
    return widgets;
  }

  String _dayLetter(int weekday, bool isArabic) {
    if (isArabic) {
      switch (weekday) {
        case DateTime.saturday:
          return 'س';
        case DateTime.sunday:
          return 'ح';
        case DateTime.monday:
          return 'ن';
        case DateTime.tuesday:
          return 'ث';
        case DateTime.wednesday:
          return 'ر';
        case DateTime.thursday:
          return 'خ';
        case DateTime.friday:
          return 'ج';
      }
    } else {
      switch (weekday) {
        case DateTime.saturday:
          return 'S';
        case DateTime.sunday:
          return 'S';
        case DateTime.monday:
          return 'M';
        case DateTime.tuesday:
          return 'T';
        case DateTime.wednesday:
          return 'W';
        case DateTime.thursday:
          return 'T';
        case DateTime.friday:
          return 'F';
      }
    }
    return '';
  }
}
