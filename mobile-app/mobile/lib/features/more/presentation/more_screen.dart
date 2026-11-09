import 'package:lifestyle_mobile/features/focus_shield/routine_wizard_screen.dart';
import 'package:lifestyle_mobile/features/focus_shield/weekly_review_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/analytics/presentation/analytics_screen.dart';
import 'package:lifestyle_mobile/features/calendar/presentation/calendar_screen.dart';
import 'package:lifestyle_mobile/features/goals/presentation/goals_screen.dart';
import 'package:lifestyle_mobile/features/home/presentation/widgets/global_search_delegate.dart';
import 'package:lifestyle_mobile/features/more/presentation/daily_plan_screen.dart';
import 'package:lifestyle_mobile/features/money/presentation/subscriptions_screen.dart';
import 'package:lifestyle_mobile/features/projects/presentation/projects_screen.dart';
import 'package:lifestyle_mobile/features/recurring/presentation/recurring_tasks_screen.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

/// Hub for the areas that do not fit in the bottom navigation bar.
/// Items are grouped into a few labelled sections (Money / Insights /
/// Planning) so the list reads as a small set of "homes" instead of one long
/// flat menu. Focus has its own bottom-navigation tab and no longer appears
/// here.
class MoreScreen extends ConsumerWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final isAr = l10n.isArabic;
    final theme = Theme.of(context);
    final sections = <_MoreSection>[
      _MoreSection(
        title: l10n.moreSectionMoney,
        items: [
          _MoreItem(
            icon: Icons.event_repeat,
            title: l10n.subscriptionsTitle,
            subtitle: l10n.tr('moreSubscriptionsSubtitle'),
            builder: (_) => const SubscriptionsScreen(),
          ),
        ],
      ),
      _MoreSection(
        title: l10n.moreSectionInsights,
        items: [
          _MoreItem(
            icon: Icons.insights,
            title: l10n.analyticsTitle,
            subtitle: l10n.tr('analyticsDashboardSubtitle'),
            builder: (_) => const AnalyticsScreen(),
          ),
          _MoreItem(
            icon: Icons.assessment_outlined,
            title: l10n.tr('weeklyReportTitle'),
            subtitle: l10n.tr('weeklyReportSubtitle'),
            builder: (_) => const WeeklyReviewScreen(),
          ),
        ],
      ),
      _MoreSection(
        title: l10n.moreSectionPlanning,
        items: [
          _MoreItem(
            icon: Icons.dashboard_outlined,
            title: l10n.tr('dailyPlanTitle'),
            subtitle: l10n.tr('dailyPlanSubtitle'),
            builder: (_) => const DailyPlanScreen(),
          ),
          _MoreItem(
            icon: Icons.wb_twilight,
            title: l10n.tr('dailyRoutinesTitle'),
            subtitle: l10n.tr('dailyRoutinesSubtitle'),
            builder: (_) => const RoutineWizardScreen(),
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
        ],
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
          for (final section in sections) ...[
            Padding(
              padding: const EdgeInsets.only(top: 8, bottom: 4),
              child: Text(
                section.title,
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: theme.colorScheme.primary,
                ),
              ),
            ),
            for (final item in section.items)
              Card(
                margin: const EdgeInsets.symmetric(vertical: 6),
                child: ListTile(
                  leading: Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: theme.colorScheme.primaryContainer,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(
                      item.icon,
                      color: theme.colorScheme.onPrimaryContainer,
                      size: 20,
                    ),
                  ),
                  title: Text(item.title),
                  subtitle: Text(item.subtitle),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(builder: item.builder),
                  ),
                ),
              ),
          ],
        ],
      ),
    );
  }
}

class _MoreSection {
  const _MoreSection({required this.title, required this.items});

  final String title;
  final List<_MoreItem> items;
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
