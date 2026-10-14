import 'package:lifestyle_mobile/features/focus_shield/routine_wizard_screen.dart';
import 'package:lifestyle_mobile/features/focus_shield/weekly_review_screen.dart';
import 'package:lifestyle_mobile/features/focus_shield/focus_shield_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/calendar/presentation/calendar_screen.dart';
import 'package:lifestyle_mobile/features/goals/presentation/goals_screen.dart';
import 'package:lifestyle_mobile/features/home/presentation/widgets/global_search_delegate.dart';
import 'package:lifestyle_mobile/features/more/presentation/daily_plan_screen.dart';
import 'package:lifestyle_mobile/features/projects/presentation/projects_screen.dart';
import 'package:lifestyle_mobile/features/recurring/presentation/recurring_tasks_screen.dart';
import 'package:lifestyle_mobile/features/timer/presentation/focus_history_screen.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

/// Hub for the planning areas that do not fit in the bottom navigation bar.
class MoreScreen extends ConsumerWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final isAr = l10n.isArabic;
    final items = <_MoreItem>[
      _MoreItem(
          icon: Icons.wb_twilight,
          title: 'Daily routines',
          subtitle: 'Morning Kickoff & Night Shutdown',
          builder: (_) => const RoutineWizardScreen()),
      _MoreItem(
          icon: Icons.insights,
          title: 'Weekly Brain Report',
          subtitle: 'Private metrics and optional AI coaching',
          builder: (_) => const WeeklyReviewScreen()),
      _MoreItem(
          icon: Icons.shield_outlined,
          title: 'Focus Shield',
          subtitle: isAr
              ? 'التركيز، النقاط وصندوق رسائل التركيز'
              : 'Focus, XP and Focus Inbox',
          builder: (_) => const FocusShieldScreen()),
      _MoreItem(
        icon: Icons.dashboard_outlined,
        title: isAr ? 'خطة اليوم والملخص' : 'Daily Plan & Overview',
        subtitle: isAr
            ? 'ملخص شامل لمهام وعادات وأحداث واشتراكات اليوم'
            : 'Unified overview of today\'s tasks, habits, events and bills',
        builder: (_) => const DailyPlanScreen(),
      ),
      _MoreItem(
        icon: Icons.calendar_month_outlined,
        title: l10n.calendarTitle,
        subtitle: l10n.calendarSubtitle,
        builder: (_) => const CalendarScreen(),
      ),
      _MoreItem(
        icon: Icons.flag_outlined,
        title: l10n.goalsTitle,
        subtitle: l10n.goalsSubtitle,
        builder: (_) => const GoalsScreen(),
      ),
      _MoreItem(
        icon: Icons.folder_outlined,
        title: l10n.projects,
        subtitle: l10n.projectsSubtitle,
        builder: (_) => const ProjectsScreen(),
      ),
      _MoreItem(
        icon: Icons.event_repeat_outlined,
        title: l10n.recurringTasksTitle,
        subtitle: l10n.recurringSubtitle,
        builder: (_) => const RecurringTasksScreen(),
      ),
      _MoreItem(
        icon: Icons.timer_outlined,
        title: l10n.focusHistoryTitle,
        subtitle: l10n.focusHistorySubtitle,
        builder: (_) => const FocusHistoryScreen(),
      ),
    ];

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.moreTitle),
        actions: [
          IconButton(
            tooltip: l10n.globalSearchTooltip,
            icon: const Icon(Icons.search),
            onPressed: () {
              showSearch<void>(
                context: context,
                delegate: GlobalSearchDelegate(ref, isArabic: isAr),
              );
            },
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          for (final item in items)
            Card(
              margin: const EdgeInsets.symmetric(vertical: 6),
              child: ListTile(
                leading: Icon(item.icon),
                title: Text(item.title),
                subtitle: Text(item.subtitle),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: item.builder),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _MoreItem {
  const _MoreItem({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.builder,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final WidgetBuilder builder;
}
