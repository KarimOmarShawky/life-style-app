import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/product_events.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_models.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_provider.dart';
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

  Future<void> _checkIn(String today) async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final habit = widget.habit;
    setState(() => _checkingIn = true);
    var saved = false;
    try {
      await ref
          .read(habitsRepositoryProvider)
          .checkinHabit(habit.id, today, status: 'done');
      saved = true;
      ref.recordProductEvent(ProductEvent.habitCheckedIn);
      await ref
          .read(focusShieldProvider.notifier)
          .award(XpType.habit, habit.id, dateKey: today);
    } catch (_) {
      // Reported below. A failed XP award never hides a saved check-in.
    }
    if (!mounted) return;
    if (saved) ref.invalidate(habitsProvider);
    setState(() => _checkingIn = false);
    messenger.showSnackBar(
      SnackBar(
        content: Text(saved ? l10n.completedToday : l10n.habitCheckInFailed),
        duration: const Duration(seconds: 2),
      ),
    );
  }

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
            // Name, description and streak status beside the check-in button.
            // Everything wraps, so large text sizes never overflow (G7).
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
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
                            color: colorScheme.onSurfaceVariant,
                            fontSize: 13,
                          ),
                        ),
                      ],
                      const SizedBox(height: 8),
                      _StreakSummary(habit: habit),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filledTonal(
                  tooltip: l10n.habitCheckInTooltip,
                  icon: _checkingIn
                      ? const SizedBox.square(
                          dimension: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.check),
                  onPressed: _checkingIn ? null : () => _checkIn(today),
                ),
              ],
            ),
            const SizedBox(height: 14),
            const Divider(height: 1),
            const SizedBox(height: 10),

            // The last seven days, for orientation only. It carries no habit
            // data, so screen readers skip it, and it shrinks instead of
            // clipping at large text sizes.
            ExcludeSemantics(
              child: Row(
                children: [
                  for (var i = 6; i >= 0; i--)
                    Expanded(
                      child: _DayMark(
                        day: DateTime(now.year, now.month, now.day - i),
                        isToday: i == 0,
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Streak status without guilt (feature guide G4): a zero streak invites a
/// start, and the best streak stays visible after a break.
class _StreakSummary extends StatelessWidget {
  const _StreakSummary({required this.habit});

  final Habit habit;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final current = habit.currentStreak;
    final best = habit.longestStreak;
    return Wrap(
      spacing: 8,
      runSpacing: 6,
      children: [
        if (current > 0)
          _StreakChip(
            icon: Icons.local_fire_department,
            label: l10n.habitStreakDays(current),
          )
        else
          _StreakChip(
            icon: Icons.wb_sunny_outlined,
            label: best > 0 ? l10n.habitFreshStart : l10n.habitStartToday,
          ),
        if (best > current)
          _StreakChip(
            icon: Icons.emoji_events_outlined,
            label: l10n.habitBestStreak(best),
          ),
      ],
    );
  }
}

class _StreakChip extends StatelessWidget {
  const _StreakChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: colors.secondaryContainer,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: colors.onSecondaryContainer),
          const SizedBox(width: 4),
          Flexible(
            child: Text(
              label,
              style: TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 13,
                color: colors.onSecondaryContainer,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DayMark extends StatelessWidget {
  const _DayMark({required this.day, required this.isToday});

  final DateTime day;
  final bool isToday;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    // Narrow weekday names in the app language; the list starts on Sunday.
    final letter =
        MaterialLocalizations.of(context).narrowWeekdays[day.weekday % 7];
    // The circle grows with the text so the date is never clipped.
    final size = MediaQuery.textScalerOf(context).scale(28);
    return FittedBox(
      fit: BoxFit.scaleDown,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            letter,
            style: TextStyle(
              fontSize: 11,
              fontWeight: isToday ? FontWeight.bold : FontWeight.normal,
              color: isToday ? colors.primary : colors.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 6),
          Container(
            width: size,
            height: size,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: isToday
                  ? colors.primaryContainer
                  : colors.surfaceContainerHighest,
              border: isToday
                  ? Border.all(color: colors.primary, width: 2)
                  : null,
            ),
            child: Text(
              '${day.day}',
              style: TextStyle(
                fontSize: 11,
                fontWeight: isToday ? FontWeight.bold : FontWeight.normal,
                color: isToday ? colors.onPrimaryContainer : null,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
