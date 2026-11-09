import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';
import 'package:lifestyle_mobile/features/tasks/state/tasks_provider.dart';
import 'package:lifestyle_mobile/features/timer/state/timer_sessions_provider.dart';
import 'package:lifestyle_mobile/features/habits/state/habits_provider.dart';
import 'package:lifestyle_mobile/features/more/data/daily_plan_models.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';
import 'focus_shield_provider.dart';
import 'focus_shield_models.dart';
import 'routine_and_weekly_models.dart';

class WeeklyReviewScreen extends ConsumerStatefulWidget {
  const WeeklyReviewScreen({super.key});
  @override
  ConsumerState<WeeklyReviewScreen> createState() => _WeeklyReviewScreenState();
}

class _WeeklyReviewScreenState extends ConsumerState<WeeklyReviewScreen> {
  WeeklyMetrics? _metrics;
  String? _coaching;
  bool _loading = true;
  bool _generating = false;
  Future<T?> _optional<T>(Future<T> request) async {
    try {
      return await request;
    } catch (_) {
      return null;
    }
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final focus = await ref.read(focusShieldProvider.future);
    if (!mounted) return;
    final now = DateTime.now();
    final from = DateTime(now.year, now.month, now.day - 6);
    final to = DateTime(now.year, now.month, now.day + 1);
    final tasksRequest =
        _optional(ref.read(tasksRepositoryProvider).listAllTasks());
    final sessionsRequest = _optional(ref
        .read(timerSessionsRepositoryProvider)
        .listWindow(from.subtract(const Duration(hours: 12)), to));
    final habitsRequest =
        _optional(ref.read(habitsRepositoryProvider).listHabits());
    final daysRequest = _optional(Future.wait(List.generate(7, (index) {
      final date = DateTime(from.year, from.month, from.day + index);
      return ref
          .read(dailyPlanRepositoryProvider)
          .getDayPlan(date: localDateKey(date));
    })));
    final tasks = await tasksRequest;
    final sessions = await sessionsRequest;
    final habits = await habitsRequest;
    final days = await daysRequest;
    final due = days
        ?.expand((day) => day.habits)
        .where((habit) => habit.dueOn)
        .toList();
    final metrics = calculateWeeklyMetrics(
      now: now,
      history: focus.history,
      backendSessions: sessions,
      tasks: tasks,
      habitsDue: due?.length,
      habitsDone: due?.where((habit) => habit.completedOn).length,
      activeStreaks: habits
          ?.where(
              (habit) => habit.status == 'active' && habit.currentStreak > 0)
          .length,
    );
    if (!mounted) return;
    setState(() {
      _metrics = metrics;
      _coaching = metrics.offlineSummary();
      _loading = false;
    });
  }

  Future<void> _generate() async {
    final metrics = _metrics;
    if (metrics == null || _generating) return;
    setState(() => _generating = true);
    try {
      final ai = AiService.instance;
      if (ai.isPaused) {
        if (mounted) {
          setState(() => _coaching = metrics.offlineSummary());
        }
        return;
      }
      if (!mounted) return;
      final consent = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
                title: Text(AppLocalizations.of(context).tr('weeklySendTitle')),
                content: SingleChildScrollView(
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Text(AppLocalizations.of(context).tr('weeklySendBody')),
                  SelectableText(const JsonEncoder.withIndent('  ')
                      .convert(metrics.aggregates())),
                ])),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(context, false),
                      child: Text(AppLocalizations.of(context)
                          .tr('weeklyKeepOffline'))),
                  FilledButton(
                      onPressed: () => Navigator.pop(context, true),
                      child: Text(
                          AppLocalizations.of(context).tr('weeklySendRequest')))
                ],
              ));
      if (consent != true) return;
      final coaching =
          await ai.generateWeeklyCoaching(aggregates: metrics.aggregates());
      if (mounted) {
        setState(() => _coaching = coaching ?? metrics.offlineSummary());
      }
    } catch (_) {
      if (mounted) {
        setState(() => _coaching = metrics.offlineSummary());
      }
    } finally {
      if (mounted) {
        setState(() => _generating = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
            title: Text(AppLocalizations.of(context).tr('weeklyReportTitle')),
            actions: [
              IconButton(
                  onPressed: _loading ? null : _load,
                  icon: const Icon(Icons.refresh),
                  tooltip: AppLocalizations.of(context).tr('weeklyRefresh')),
              IconButton(
                  onPressed: _metrics == null
                      ? null
                      : () => Clipboard.setData(ClipboardData(
                          text: '${_metrics!.report()}\n\n${_coaching ?? ''}')),
                  icon: const Icon(Icons.copy),
                  tooltip: AppLocalizations.of(context).tr('weeklyCopy'))
            ]),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : ListView(padding: const EdgeInsets.all(16), children: [
                if (_metrics == null)
                  Text(AppLocalizations.of(context).tr('weeklyNoData'))
                else
                  WeeklyMetricsSummary(metrics: _metrics!),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: _generating ? null : _generate,
                    child: Text(
                      _generating
                          ? AppLocalizations.of(context).tr('weeklyGenerating')
                          : AppLocalizations.of(context).tr('weeklyGenerate'),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                if ((_coaching ?? '').isNotEmpty)
                  Card(
                    margin: EdgeInsets.zero,
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            AppLocalizations.of(context).tr('weeklyCoaching'),
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const SizedBox(height: 8),
                          SelectableText(_coaching!),
                        ],
                      ),
                    ),
                  ),
              ]),
      );
}

/// Card-based weekly metrics. The plain-text [WeeklyMetrics.report] remains
/// the copy/export format; on screen the numbers are easier to scan as
/// separate tiles instead of one stacked paragraph.
class WeeklyMetricsSummary extends StatelessWidget {
  const WeeklyMetricsSummary({super.key, required this.metrics});

  final WeeklyMetrics metrics;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final noData = l10n.tr('weeklyNoData');
    final habitRate = metrics.habitRate;
    final tiles = <_WeeklyMetricTileData>[
      _WeeklyMetricTileData(
        label: l10n.tr('weeklyTasksCompleted'),
        value: '${metrics.tasksCompleted ?? noData}',
      ),
      _WeeklyMetricTileData(
        label: l10n.tr('weeklyPendingDue'),
        value: '${metrics.tasksPending ?? noData}',
      ),
      _WeeklyMetricTileData(
        label: l10n.tr('weeklyHabitConsistency'),
        value: habitRate == null ? noData : '${habitRate.toStringAsFixed(1)}%',
        detail: l10n
            .tr('weeklyCheckins')
            .replaceAll('{done}', '${metrics.habitsDone ?? noData}')
            .replaceAll('{due}', '${metrics.habitsDue ?? noData}'),
      ),
      _WeeklyMetricTileData(
        label: l10n.tr('weeklyActiveStreaks'),
        value: '${metrics.activeStreaks ?? noData}',
      ),
      _WeeklyMetricTileData(
        label: l10n.tr('weeklyFocusTime'),
        value:
            '${(metrics.focusSeconds / 60).toStringAsFixed(1)} ${l10n.tr('detoxMin')}',
        detail:
            '${l10n.focusSessionsCount(metrics.sessionCount)}${metrics.localFocusOnly ? ' · ${l10n.tr('weeklyLocalOnly')}' : ''}',
      ),
      _WeeklyMetricTileData(
        label: l10n.tr('weeklyBlockedAttempts'),
        value: '${metrics.attempts}',
      ),
      _WeeklyMetricTileData(
        label: l10n.tr('weeklyClarity'),
        value: metrics.averageClarity?.toStringAsFixed(1) ?? noData,
      ),
      _WeeklyMetricTileData(
        label: l10n.tr('weeklyEstimatedSaved'),
        value: '${metrics.estimatedMinutesSaved} ${l10n.tr('detoxMin')}',
        detail: l10n
            .tr('weeklyEstimateNote')
            .replaceAll('{n}', '$estimatedMinutesSavedPerAttempt'),
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '${localDateKey(metrics.from)} — ${localDateKey(metrics.to.subtract(const Duration(microseconds: 1)))}',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 6),
        Text(l10n.tr('weeklyUnavailableNote')),
        const SizedBox(height: 12),
        LayoutBuilder(
          builder: (context, constraints) {
            final columns = constraints.maxWidth >= 620
                ? 3
                : constraints.maxWidth >= 360
                    ? 2
                    : 1;
            final tileWidth =
                (constraints.maxWidth - (columns - 1) * 12) / columns;
            return Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [
                for (final tile in tiles)
                  SizedBox(
                    width: tileWidth,
                    child: _WeeklyMetricTile(data: tile),
                  ),
              ],
            );
          },
        ),
      ],
    );
  }
}

class _WeeklyMetricTileData {
  const _WeeklyMetricTileData({
    required this.label,
    required this.value,
    this.detail,
  });

  final String label;
  final String value;
  final String? detail;
}

class _WeeklyMetricTile extends StatelessWidget {
  const _WeeklyMetricTile({required this.data});

  final _WeeklyMetricTileData data;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              data.label,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 6),
            Text(
              data.value,
              style: Theme.of(context).textTheme.titleLarge,
            ),
            if (data.detail != null) ...[
              const SizedBox(height: 4),
              Text(
                data.detail!,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
